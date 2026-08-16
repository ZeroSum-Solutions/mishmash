import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeHeroCss = readFileSync(
  new URL('../../src/styles/home/home-hero.css', import.meta.url),
  'utf8',
);

type StyleRule = { media: string | null; selectors: string[]; declarations: string };

/**
 * Parses the stylesheet into rules that remember which `@media` block they came
 * from.
 *
 * A flat regex scan cannot express the invariant these tests exist to protect.
 * `.home-hero__execution-switcher .inline-switcher__chip` is declared three
 * times — once at the top level and once inside each of two `@media` blocks —
 * so a scan that ignores at-rule nesting silently reads the narrowest override
 * and reports it as the base value. Media context is therefore part of a rule's
 * identity here, not incidental.
 */
function parseRules(css: string): StyleRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: StyleRule[] = [];

  const blockEnd = (text: string, open: number): number => {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return text.length;
  };

  const walk = (text: string, media: string | null): void => {
    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf('{', cursor);
      if (open === -1) return;
      const head = text.slice(cursor, open).trim();
      const close = blockEnd(text, open);
      const body = text.slice(open + 1, close);

      if (/^@media\b/i.test(head)) {
        walk(body, head.replace(/^@media\s*/i, '').trim());
      } else if (/^@(supports|layer|container)\b/i.test(head)) {
        // Conditional group rules wrap real style rules, so descend but keep the
        // media context unchanged. `@keyframes` and `@font-face` deliberately
        // fall through to the skip branch below: their inner blocks are keyframe
        // selectors (`from`, `50%`), not style rules, and admitting them would
        // pollute every lookup.
        walk(body, media);
      } else if (head && !head.startsWith('@')) {
        rules.push({
          media,
          selectors: head.split(',').map((item) => item.trim()),
          declarations: body,
        });
      }
      cursor = close + 1;
    }
  };

  walk(withoutComments, null);
  return rules;
}

const allRules = parseRules(homeHeroCss);

/** Compares media queries by meaning, so `(max-width: 560px)` and `max-width:560px` match. */
function normalizeMedia(query: string): string {
  return query.replace(/[()\s]/g, '').toLowerCase();
}

/**
 * Returns the declarations for `selector` within one media context.
 *
 * `media` defaults to `null`, meaning the top-level (unconditional) rule — the
 * value that applies on a desktop viewport. Pass the query text to assert a
 * responsive override instead.
 */
function cssDeclarations(selector: string, media: string | null = null): string {
  const want = media === null ? null : normalizeMedia(media);
  const blocks = allRules
    .filter(
      (rule) =>
        (rule.media === null ? null : normalizeMedia(rule.media)) === want &&
        rule.selectors.includes(selector),
    )
    .map((rule) => rule.declarations);
  if (blocks.length === 0) {
    throw new Error(
      `Missing CSS block for ${selector}${media ? ` inside @media ${media}` : ' at top level'}`,
    );
  }
  return blocks.join('\n');
}

function ruleValue(block: string, property: string): string {
  // The trailing `;` is optional: it is legal to omit it on the final
  // declaration of a block, and requiring it made this helper throw
  // `Missing CSS property` on valid stylesheets.
  const matches = [
    ...block.matchAll(new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*([^;}]+)(?:;|$)`, 'g')),
  ];
  const match = matches.at(-1);
  if (!match) throw new Error(`Missing CSS property ${property}`);
  return match[1]!.trim();
}

/** True when `block` declares `property` at all — used for must-NOT-set assertions. */
function declaresProperty(block: string, property: string): boolean {
  return new RegExp(`(?:^|[;\\n])\\s*${property}:`).test(block);
}

/** Parses a `px` value so a floor can be asserted instead of an exact pixel count. */
function pxValue(block: string, property: string): number {
  const raw = ruleValue(block, property);
  const parsed = Number.parseFloat(raw.replace(/px$/, ''));
  if (!raw.endsWith('px') || Number.isNaN(parsed)) {
    throw new Error(`Expected a px value for ${property}, got "${raw}"`);
  }
  return parsed;
}

const NARROW = 'max-width: 900px';
const TOUCH = 'max-width: 560px';
const CHIP = '.home-hero__execution-switcher .inline-switcher__chip';

describe('HomeHero compact composer controls', () => {
  it('keeps the floating @ picker shell stable while result tabs change', () => {
    const floatingPicker = cssDeclarations(
      '.caret-floating-layer .home-hero__plugin-picker--floating',
    );
    const picker = cssDeclarations('.home-hero__plugin-picker');
    const results = cssDeclarations('.home-hero__plugin-picker-results');

    expect(ruleValue(floatingPicker, 'height')).toBe('var(--cfl-max-h, 60vh)');
    expect(ruleValue(floatingPicker, 'max-height')).toBe('var(--cfl-max-h, 60vh)');
    expect(ruleValue(picker, 'overflow')).toBe('hidden');
    expect(ruleValue(results, 'flex')).toBe('1 1 auto');
    expect(ruleValue(results, 'overflow-y')).toBe('auto');
  });

  it('keeps the execution button compact in the hero', () => {
    const switcherChip = cssDeclarations(CHIP);

    // The execution switcher keeps a fixed icon+chevron footprint on desktop.
    expect(ruleValue(switcherChip, 'height')).toBe('32px');
    expect(ruleValue(switcherChip, 'max-width')).toBe('58px');
  });

  it('promotes the execution switcher to a 44px touch target on phones', () => {
    // The compact 32px desktop footprint is deliberately overridden below the
    // touch breakpoint: a pointer-coarse target smaller than 44px fails the
    // pointer-target guidance the responsive pass was introduced to satisfy.
    // Asserted explicitly so neither half can regress silently — tightening the
    // desktop chip must not shrink the phone target, and vice versa.
    //
    // A floor, not an equality: growing the target to 48px is a legitimate
    // design change, shrinking it below 44px is the regression worth catching.
    const touchChip = cssDeclarations(CHIP, TOUCH);

    expect(pxValue(touchChip, 'height')).toBeGreaterThanOrEqual(44);
    expect(pxValue(touchChip, 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('prevents the compact execution switcher from expanding on narrow screens', () => {
    const switcher = cssDeclarations('.home-hero__execution-switcher', NARROW);
    const switcherChip = cssDeclarations(CHIP, NARROW);

    expect(ruleValue(switcher, 'flex-basis')).toBe('auto');
    expect(ruleValue(switcherChip, 'width')).toBe('58px');
    expect(ruleValue(switcherChip, 'max-width')).toBe('58px');

    // This breakpoint constrains width only. If it ever also set a height it
    // would land between the desktop base and the touch override and silently
    // decide the chip's height for every tablet — a change that would otherwise
    // pass both of the tests above.
    expect(declaresProperty(switcherChip, 'height')).toBe(false);
  });

  it('keeps the template picker search field free of the global input focus halo', () => {
    const templateSearchFocus = cssDeclarations('.home-hero__template-search input:focus');

    expect(ruleValue(templateSearchFocus, 'outline')).toBe('none');
    expect(ruleValue(templateSearchFocus, 'box-shadow')).toBe('none');
  });
});
