import { describe, expect, it } from 'vitest';
import type { DesignSystemSummary, PromptTemplateSummary, SkillSummary } from '../../src/types';
import {
  hasLocalizedContent,
  localizeDesignSystemSummary,
  localizePromptTemplateSummary,
  localizeSkillDescription,
  localizeSkillName,
  localizeSkillPrompt,
} from '../../src/i18n/content';

// Open Design ships English-only: `content.<locale>.ts` bundles were removed
// in the de-bloat pass, so every resolver below falls straight through to the
// source (English) fields. These tests lock that fallback behavior in place.
describe('localized resource content (English-only)', () => {
  it('never reports a localized-content bundle', () => {
    expect(hasLocalizedContent('en')).toBe(false);
  });

  it('uses inline skill display metadata when present, otherwise source fields', () => {
    const inlineSkill = {
      id: 'inline-skill',
      name: 'inline-skill',
      displayName: { en: 'Inline Skill' },
      description: ' English description from source. ',
      descriptionI18n: { en: 'English inline description.' },
      examplePrompt: ' English prompt from source. ',
      examplePromptI18n: { en: 'English inline prompt.' },
    } as unknown as SkillSummary;

    expect(localizeSkillName('en', inlineSkill)).toBe('Inline Skill');
    expect(localizeSkillDescription('en', inlineSkill)).toBe('English inline description.');
    expect(localizeSkillPrompt('en', inlineSkill)).toBe('English inline prompt.');
  });

  it('falls back to source fields when no inline metadata is present', () => {
    const sourceOnlySkill = {
      id: 'blog-post',
      name: 'blog-post',
      examplePrompt: '  English prompt from source.  ',
      description: '  English description from source.  ',
    } as unknown as SkillSummary;

    expect(localizeSkillName('en', sourceOnlySkill)).toBe('blog-post');
    expect(localizeSkillPrompt('en', sourceOnlySkill)).toBe('English prompt from source.');
    expect(localizeSkillDescription('en', sourceOnlySkill)).toBe('English description from source.');
  });

  it('passes design-system summaries through unchanged', () => {
    const system = {
      id: 'agentic',
      summary: ' English summary from source. ',
      category: 'English category',
    } as DesignSystemSummary;

    expect(localizeDesignSystemSummary('en', system)).toBe(' English summary from source. ');
  });

  it('passes prompt-template summaries through unchanged', () => {
    const template = {
      id: 'notion-team-dashboard-live-artifact',
      surface: 'image',
      title: ' English title from source ',
      summary: ' English summary from source ',
      category: 'General',
      tags: ['unknown-tag'],
      source: { repo: 'repo', license: 'MIT' },
    } satisfies PromptTemplateSummary;

    expect(localizePromptTemplateSummary('en', template)).toEqual(template);
  });
});
