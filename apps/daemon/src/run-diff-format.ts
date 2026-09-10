/** Above this many lines on either side, the LCS table is not worth building. */
const LCS_LINE_BUDGET = 4000;

/**
 * Renders a line diff of two text versions for a terminal.
 *
 * INVARIANT: every line of output is prefixed `-`, `+`, or a space, and the
 * `-`/`+` lines reconstruct the two inputs exactly. A reader must be able to
 * trust that what is not marked did not change.
 *
 * Falls back to "whole file replaced" past `LCS_LINE_BUDGET` lines: the exact
 * diff of two huge generated artifacts costs quadratic memory and reads no
 * better than the plain statement that everything changed.
 */
export function unifiedDiffLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > LCS_LINE_BUDGET || b.length > LCS_LINE_BUDGET) {
    return [
      `- (${a.length} lines replaced)`,
      `+ (${b.length} lines)`,
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push(`- ${a[i]}`);
  for (; j < b.length; j += 1) out.push(`+ ${b[j]}`);
  return out;
}
