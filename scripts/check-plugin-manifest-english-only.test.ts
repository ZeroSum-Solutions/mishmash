import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Open Design ships English-only (see AGENTS.md "i18n keys"). An earlier
// de-bloat pass removed non-English locale dictionaries from the app, docs,
// and UI but missed the bundled plugin manifests at
// `plugins/_official/**/open-design.json`. Those have since been cleaned:
// every `*_i18n` key was removed, and bare locale-map objects (the shape that
// hid `od.useCase.query` from a naive `_i18n` scan) were collapsed to their
// `en` string. This guard keeps both shapes from reappearing.
//
// Deliberately NOT a CJK-character scan: legitimate non-English text remains
// in these files (credited author names like "阿绎 AYi" or "松果先森",
// content descriptions that reference non-English subject matter) and must
// keep passing. This guard targets i18n KEY STRUCTURE only.

const repoRoot = path.resolve(import.meta.dirname, "..");
const officialPluginsRoot = path.join(repoRoot, "plugins", "_official");

// Minimum manifest count we expect to find. Guards against the walk silently
// finding zero files (e.g. a bad path or an accidentally-skipped directory)
// and the test passing vacuously. The corpus is ~455 manifests at time of
// writing; 100 is a generous floor that won't flake on legitimate additions
// or removals.
const MIN_EXPECTED_MANIFEST_COUNT = 100;

// A "bare locale map" is an object whose keys are all BCP-47-ish locale tags
// (en, zh-CN, zh-TW, ja, ko, fr, ...) and which includes an "en" key -- the
// shape `od.useCase.query` used to take before the de-bloat pass collapsed it
// to a plain string. Requiring >=2 keys and an "en" key keeps this from
// tripping on unrelated short lowercase keys (e.g. `id`, `url`, `ref`) that
// appear throughout the schema but never co-occur as an all-locale-tag,
// "en"-inclusive object.
const LOCALE_TAG_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;

function isBareLocaleMapObject(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length < 2) return false;
  if (!keys.includes("en")) return false;
  return keys.every((key) => LOCALE_TAG_PATTERN.test(key));
}

/**
 * Recursively walks a parsed manifest value and returns human-readable
 * violation strings (JSON-path prefixed, no file name) for any:
 *   - key anywhere in the tree ending in `_i18n`
 *   - object anywhere in the tree that is a bare locale map (see above)
 */
function collectEnglishOnlyViolations(value: unknown, jsonPath: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectEnglishOnlyViolations(item, `${jsonPath}[${index}]`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }

  const obj = value as Record<string, unknown>;
  const violations: string[] = [];

  if (isBareLocaleMapObject(obj)) {
    violations.push(`${jsonPath} is a bare locale-map object (keys: ${Object.keys(obj).join(", ")})`);
  }

  for (const [key, child] of Object.entries(obj)) {
    if (key.endsWith("_i18n")) {
      violations.push(`${jsonPath}.${key} is a legacy _i18n key`);
    }
    violations.push(...collectEnglishOnlyViolations(child, `${jsonPath}.${key}`));
  }

  return violations;
}

function listOfficialPluginManifests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listOfficialPluginManifests(full));
    } else if (entry.isFile() && entry.name === "open-design.json") {
      out.push(full);
    }
  }
  return out;
}

test("collectEnglishOnlyViolations flags a nested _i18n key", () => {
  const violations = collectEnglishOnlyViolations(
    {
      od: {
        useCase: {
          exampleOutputs: [{ path: "./example.html", title_i18n: { en: "Title", "zh-CN": "标题" } }],
        },
      },
    },
    "$",
  );
  assert.ok(
    violations.some((v) => v === "$.od.useCase.exampleOutputs[0].title_i18n is a legacy _i18n key"),
    violations.join("\n"),
  );
});

test("collectEnglishOnlyViolations flags a bare locale-map object", () => {
  const violations = collectEnglishOnlyViolations(
    { od: { useCase: { query: { en: "Create a thing.", "zh-CN": "创建一个东西。" } } } },
    "$",
  );
  assert.ok(
    violations.some((v) => v.startsWith("$.od.useCase.query is a bare locale-map object")),
    violations.join("\n"),
  );
});

test("collectEnglishOnlyViolations does not flag credited author names containing CJK text", () => {
  const violations = collectEnglishOnlyViolations(
    {
      author: { name: "阿绎 AYi", url: "https://github.com/example" },
      od: {
        provenance: {
          via_skill: { name: "huashu-design", author: "alchaincyf (花叔 · 花生)" },
        },
      },
    },
    "$",
  );
  assert.deepEqual(violations, []);
});

test("collectEnglishOnlyViolations does not flag unrelated short-key objects", () => {
  // `od`, `id`, `url`, `ref`, `min`, `max` are all real schema keys that
  // happen to be 2-3 lowercase letters -- confirm they never trip the
  // locale-map heuristic when mixed with non-locale-shaped keys.
  const violations = collectEnglishOnlyViolations(
    { id: "my-plugin", url: "https://example.com", ref: "main", min: 1, max: 5 },
    "$",
  );
  assert.deepEqual(violations, []);
});

test("every plugins/_official/**/open-design.json is English-only in i18n key structure", () => {
  const manifestPaths = listOfficialPluginManifests(officialPluginsRoot).sort();

  assert.ok(
    manifestPaths.length >= MIN_EXPECTED_MANIFEST_COUNT,
    `expected at least ${MIN_EXPECTED_MANIFEST_COUNT} plugin manifests under plugins/_official, found ${manifestPaths.length}`,
  );

  let checked = 0;
  const violations: string[] = [];

  for (const manifestPath of manifestPaths) {
    const relPath = path.relative(repoRoot, manifestPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      violations.push(`${relPath}: failed to parse as JSON (${(err as Error).message})`);
      continue;
    }
    checked += 1;
    for (const violation of collectEnglishOnlyViolations(parsed, "$")) {
      violations.push(`${relPath}: ${violation}`);
    }
  }

  // eslint-disable-next-line no-console -- deliberate: report the count checked
  // so a future zero-file regression (bad path, skipped directory) is visible
  // even when the test passes.
  console.log(`check-plugin-manifest-english-only: checked ${checked} of ${manifestPaths.length} plugin manifests`);

  assert.equal(
    checked,
    manifestPaths.length,
    `${manifestPaths.length - checked} manifest(s) failed to parse as JSON; see violations above`,
  );
  assert.deepEqual(violations, []);
});
