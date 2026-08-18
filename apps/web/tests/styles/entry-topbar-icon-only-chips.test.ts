import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entryShell = readFileSync(
  new URL('../../src/components/EntryShell.tsx', import.meta.url),
  'utf8',
);
const entryLayoutCss = readFileSync(
  new URL('../../src/styles/home/entry-layout.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The entry topbar renders its chips inside
 * `.entry-main__topbar-chips--icon-only`, whose rule sets
 * `.use-everywhere-chip__label { display: none }`. A chip in that row is
 * therefore drawn ENTIRELY by its `__icon` span: a chip that ships only a
 * label collapses to a blank 32x32 pill with no glyph, no text, and no
 * affordance — visible to every user on the first screen, and invisible to
 * any test that only asserts the button exists.
 *
 * The invariant: every `use-everywhere-chip` button in EntryShell carries an
 * icon span. Labels are a tooltip/screen-reader concern, never the only
 * visible content.
 */
function iconOnlyRowHidesLabels(): boolean {
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(entryLayoutCss)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    const hidesLabel = selectors.includes(
      '.entry-main__topbar-chips--icon-only .use-everywhere-chip__label',
    );
    if (hidesLabel && /display:\s*none/.test(match[2] ?? '')) return true;
  }
  return false;
}

/** Each `<button ... class="use-everywhere-chip ...">…</button>` body. */
function chipButtonBodies(): string[] {
  const bodies: string[] = [];
  const openTag = /<button\b[^>]*className="use-everywhere-chip[^"]*"[\s\S]*?>/g;
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(entryShell)) !== null) {
    const start = match.index + match[0].length;
    const end = entryShell.indexOf('</button>', start);
    if (end === -1) continue;
    bodies.push(entryShell.slice(start, end));
  }
  return bodies;
}

describe('entry topbar icon-only chips', () => {
  it('collapses chip labels, so a chip without an icon would render blank', () => {
    expect(iconOnlyRowHidesLabels()).toBe(true);
  });

  it('gives every topbar chip an icon span', () => {
    const bodies = chipButtonBodies();
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain('use-everywhere-chip__icon');
    }
  });
});
