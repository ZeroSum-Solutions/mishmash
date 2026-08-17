import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Every caret the workbench draws itself must render SOLID — a steady bar the
// eye can ignore, not a strobe competing with the artifact for attention. The
// blink was previously the default and `prefers-reduced-motion` was the only
// way to get a still caret; these assertions pin the inverse, so re-adding an
// `animation` to any of them turns this file red.
//
// Scope note: this covers carets the app PAINTS. The native text caret in a
// contenteditable/input is drawn by the browser and has no CSS off-switch for
// blinking; a still caret there would require rendering a fake one.

function readCss(relativePath: string): string {
  return readFileSync(new URL(`../../src/${relativePath}`, import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
}

const designFilesCss = readCss('styles/workspace/design-files.css');
const codeCss = readCss('styles/viewer/code.css');
const terminalCss = readCss('components/workspace/TerminalViewer.module.css');

function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rulePattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  let declarations = '';
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(css)) !== null) {
    declarations += match[1] ?? '';
  }
  return declarations;
}

const CARETS: Array<{ name: string; css: string; selector: string }> = [
  {
    name: 'Design Files useful-info typewriter caret',
    css: designFilesCss,
    selector: '.df-tip-caret',
  },
  {
    name: 'streaming prose caret',
    css: codeCss,
    selector: '.prose-block[data-stream-cursor="true"] > *:last-child::after',
  },
  {
    name: 'live-code streaming caret',
    css: codeCss,
    selector: '.live-code-caret',
  },
  {
    name: 'terminal loading cursor',
    css: terminalCss,
    selector: '.loadingCursor',
  },
];

describe('workbench carets render solid', () => {
  for (const caret of CARETS) {
    it(`does not animate the ${caret.name}`, () => {
      const declarations = declarationsFor(caret.css, caret.selector);

      // Guards against the selector being renamed out from under the assertion,
      // which would otherwise leave an empty string trivially passing.
      expect(declarations.trim()).not.toBe('');
      expect(declarations).not.toMatch(/animation/);
    });
  }

  it('leaves no caret blink keyframes defined anywhere', () => {
    for (const css of [designFilesCss, codeCss, terminalCss]) {
      expect(css).not.toMatch(/@keyframes\s+[\w-]*(caret|cursor)[\w-]*blink/);
    }
  });

  it('keeps every caret fully opaque rather than dimming it', () => {
    for (const caret of CARETS) {
      const declarations = declarationsFor(caret.css, caret.selector);
      expect(declarations).not.toMatch(/opacity:\s*0(\.\d+)?\s*;/);
    }
  });
});
