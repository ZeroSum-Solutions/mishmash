import { describe, expect, it } from 'vitest';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

const indexCss = readExpandedIndexCss();

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(indexCss);
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1] ?? '';
}

describe('default app background colors', () => {
  it('uses the release light background color by default', () => {
    const root = cssBlock(':root');

    expect(root).toContain('--bg: #f8f9fb;');
    expect(root).toContain('--bg-app: #f8f9fb;');
  });

  it('pins the dark theme background to the canonical token value', () => {
    const dark = cssBlock('[data-theme="dark"]');

    expect(dark).toContain('--bg: #18191c;');
    expect(dark).toContain('--bg-app: #18191c;');
  });

  it('prefers platform UI fonts over optional local app fonts', () => {
    const root = cssBlock(':root');
    const sans = /--sans:\s*([^;]+);/.exec(root)?.[1];

    expect(sans).toBeDefined();
    expect(sans).toContain("'Segoe UI'");
    expect(sans).not.toContain("'Inter'");
    expect(sans).toMatch(/'Segoe UI', 'Microsoft YaHei UI', 'Noto Sans'/);
  });
});
