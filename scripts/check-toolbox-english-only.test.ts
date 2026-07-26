import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Open Design ships English-only (see AGENTS.md "i18n keys"). `searchTerms` in
// design-toolbox.ts is a live fallback used to resolve a toolbox action to a
// skill when `preferredSkillIds` and `categoryHints` both miss, so any CJK
// term left in there affects user-visible matching, not just source-code
// cosmetics. This guard is a plain CJK-character scan over the whole file --
// unlike `check-plugin-manifest-english-only.test.ts`, there is no legitimate
// non-English text here to carve out (no credited author names, no
// user-supplied content), so a blanket scan is the right shape.
const repoRoot = path.resolve(import.meta.dirname, "..");
const toolboxPath = path.join(repoRoot, "apps", "web", "src", "runtime", "design-toolbox.ts");

// CJK Unified Ideographs + Extension A + Compatibility Ideographs. Covers
// Chinese/Japanese/Korean ideographs; sufficient for catching the Chinese
// searchTerms this guard targets.
const CJK_PATTERN = /[一-鿿㐀-䶿豈-﫿]/;

function findCjkLines(source: string): string[] {
  return source
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => CJK_PATTERN.test(line))
    .map(({ line, number }) => `line ${number}: ${line.trim()}`);
}

test("design-toolbox.ts contains no CJK characters", () => {
  const source = readFileSync(toolboxPath, "utf8");
  const violations = findCjkLines(source);
  assert.deepEqual(
    violations,
    [],
    `${path.relative(repoRoot, toolboxPath)} contains CJK characters; ` +
      `Open Design ships English-only and searchTerms is a live matching ` +
      `fallback, not decoration:\n${violations.join("\n")}`,
  );
});
