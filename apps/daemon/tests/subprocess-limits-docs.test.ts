// W8B work item 6: `docs/subprocess-limits.md`'s "MishMash budgets" caption
// asserts a universal unit ("Values are milliseconds.", :18) that two rows in
// its own table contradict — `OD_VIDEO_IMPORT_MAX_BYTES` is denominated in
// bytes (:28). Flagged LOW in both integration-grok-r1 (finding 2) and
// integration-grok-r2 (finding 4) and never fixed.
//
// RED on base: the caption line directly under the heading IS exactly
// "Values are milliseconds." while the bytes row sits inside the same table
// — a real, readable contradiction in a shipped doc, asserted from the file
// on disk.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC_PATH = path.resolve(HERE, '../../../docs/subprocess-limits.md');

/** The lines between `## MishMash budgets` and the next `## ` heading. */
function mishmashBudgetsSection(): string[] {
  const lines = readFileSync(DOC_PATH, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === '## MishMash budgets');
  if (start === -1) throw new Error('docs/subprocess-limits.md has no "## MishMash budgets" heading');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

describe('docs/subprocess-limits.md — the MishMash budgets caption matches its own rows', () => {
  it('still documents the byte-denominated video-import limit in that table', () => {
    const section = mishmashBudgetsSection();
    const bytesRow = section.find((line) => line.includes('OD_VIDEO_IMPORT_MAX_BYTES'));
    expect(bytesRow, 'the byte-denominated row must live in the MishMash budgets table').toBeTruthy();
    expect(bytesRow).toMatch(/bytes/);
  });

  it('does not claim every value in that table is milliseconds', () => {
    const section = mishmashBudgetsSection();
    expect(
      section.map((line) => line.trim()),
      'RED on base: the caption asserts a unit two of its own rows do not use',
    ).not.toContain('Values are milliseconds.');
    // The caption must still say something about units — the fix is a
    // reword, not a deletion.
    const caption = section.find((line) => !line.startsWith('|') && /millisecond/i.test(line));
    expect(caption, 'the caption must still name the default unit, qualified').toBeTruthy();
  });
});
