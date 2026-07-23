import type {
  DesignSystemSummary,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import type { Locale } from './types';

// Per-locale skill / design-system / prompt-template display copy
// (content.<locale>.ts — content.de.ts, content.fr.ts, ... and the DE_*/RU_*/
// ZH_CN_*/... tables that used to live directly in this file) was removed in
// the English-only de-bloat pass. Every resolver below now falls straight
// through to the English source fields; the `locale` parameters stay on the
// exported functions so call sites across `components/*` don't need to
// change.

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// `displayName` / `descriptionI18n` / `examplePromptI18n` are per-resource
// inline metadata (arbitrary BCP-47 keys authored directly on a skill or
// design-template) — a different mechanism from the app's own UI locale
// dictionaries, and out of scope for this de-bloat. This resolver still
// reads them, preferring the current locale's inline value and otherwise
// falling back to English.
function localizedRecordValue(
  locale: Locale,
  values: Record<string, string> | undefined,
  options: { includeEnglishFallback?: boolean } = {},
): string | undefined {
  if (!values) return undefined;
  if (values[locale]) return values[locale];
  if (options.includeEnglishFallback !== false && values.en) return values.en;
  return undefined;
}

// True when a locale resolves a built-in-content bundle beyond the English
// source. Always false now that the only supported locale is English.
export function hasLocalizedContent(locale: Locale): boolean {
  void locale;
  return false;
}

export function localizeSkillName(locale: Locale, skill: SkillSummary): string {
  return localizedRecordValue(locale, skill.displayName) ?? skill.name;
}

export function localizeSkillPrompt(locale: Locale, skill: SkillSummary): string | undefined {
  const inline = localizedRecordValue(locale, skill.examplePromptI18n, {
    includeEnglishFallback: false,
  });
  if (inline) return inline;
  const fallback = localizedRecordValue(locale, skill.examplePromptI18n);
  if (fallback) return fallback;
  return skill.examplePrompt ? normalizeText(skill.examplePrompt) : undefined;
}

export function localizeSkillDescription(locale: Locale, skill: SkillSummary): string {
  const inline = localizedRecordValue(locale, skill.descriptionI18n, {
    includeEnglishFallback: false,
  });
  if (inline) return inline;
  const fallback = localizedRecordValue(locale, skill.descriptionI18n);
  if (fallback) return fallback;
  return normalizeText(skill.description);
}

export function localizeDesignSystemSummary(
  locale: Locale,
  system: DesignSystemSummary,
): string {
  void locale;
  return system.summary || system.category || '';
}

export function localizeDesignSystemCategory(locale: Locale, category: string): string {
  void locale;
  return category;
}

export function localizePromptTemplateCategory(locale: Locale, category: string): string {
  void locale;
  return category;
}

export function localizePromptTemplateSummary(
  locale: Locale,
  template: PromptTemplateSummary,
): PromptTemplateSummary {
  void locale;
  return template;
}
