import { describe, expect, it } from 'vitest';
import { resolveSystemLocale } from '../../src/i18n';
import { en } from '../../src/i18n/locales/en';
import { LOCALES, LOCALE_LABEL, type Dict } from '../../src/i18n/types';

describe('i18n locales', () => {
  it('resolves the initial locale from browser language preferences, English-only', () => {
    expect(resolveSystemLocale(['en-US'])).toBe('en');
    expect(resolveSystemLocale(['zh-Hans-CN', 'en-US'])).toBe('en');
    expect(resolveSystemLocale(['nl-NL', 'en-US'])).toBe('en');
    expect(resolveSystemLocale(['nl-NL'])).toBeNull();
  });

  it('registers only English in the language menu', () => {
    expect(LOCALES).toEqual(['en']);
    expect((LOCALE_LABEL as Record<string, string>).en).toBe('English');
  });

  it('keeps brand/proper-noun labels verbatim English', () => {
    const verbatim: Array<{ key: keyof Dict; value: string }> = [
      { key: 'plugins.availableDetails.integrity', value: 'Integrity' },
    ];
    for (const { key, value } of verbatim) {
      expect(en[key], `en.${String(key)}`).toBe(value);
    }
  });
});
