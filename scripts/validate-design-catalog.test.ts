// F001 R2 — the gate that keeps design-templates/index.json honest.
//
// The index is a committed artifact, so nothing stops it drifting from the
// SKILL.md files it was generated from, or from carrying a mood outside the
// controlled vocabulary. These tests prove the gate both passes the real,
// committed index and actually detects the drift it exists to catch.
import assert from "node:assert/strict";
import test from "node:test";

import { checkDesignIndex, checkTemplates, newReport, type Report } from "./validate-design-catalog.ts";

function violations(report: Report): Array<[string, number]> {
  return Object.entries(report)
    .filter(([, list]) => list.length > 0)
    .map(([key, list]) => [key, list.length] as [string, number]);
}

test("the committed index passes every design-index check", () => {
  const report = newReport();
  const { slugs } = checkTemplates(report);
  assert.ok(slugs.size > 0, "expected the template scan to find templates");
  checkDesignIndex(report, slugs);
  const indexFailures = violations(report).filter(([key]) => key.startsWith("index-"));
  assert.deepEqual(
    indexFailures,
    [],
    `design-templates/index.json is stale or invalid -- run: node --import tsx scripts/build-design-index.ts`,
  );
});

test("every template with a SKILL.md has an index row", () => {
  const report = newReport();
  const { slugs } = checkTemplates(report);
  checkDesignIndex(report, slugs);
  assert.equal(report["index-row-missing"].length, 0);
  assert.equal(report["index-row-orphan"].length, 0);
});

test("a template missing from the index is reported, not passed over", () => {
  // The detection half: without this, a green run could mean "nothing checked".
  const report = newReport();
  const { slugs } = checkTemplates(report);
  const withGhost = new Set(slugs);
  withGhost.add("f001-template-that-does-not-exist");
  checkDesignIndex(report, withGhost);
  assert.equal(report["index-row-missing"].length, 1);
  assert.equal(report["index-row-missing"][0]?.subject, "f001-template-that-does-not-exist");
});

// A synthetic index, so each rule is shown to fire. Asserting the committed
// index is clean cannot do that: a fresh report is already empty, so that
// assertion stays green even if every check below were deleted.
function syntheticIndex(row: Record<string, unknown>) {
  return {
    generatedAt: "1970-01-01T00:00:00.000Z",
    templates: [
      {
        slug: "f001-synthetic",
        name: "Synthetic",
        family: "synthetic",
        category: "landing-page",
        scenario: null,
        tags: [],
        mood: [],
        density: "low",
        motion_level: "low",
        palette: [],
        typography: {},
        preview: null,
        sourceHash: "0".repeat(64),
        ...row,
      },
    ],
  } as never;
}

const SYNTHETIC_SLUGS = new Set(["f001-synthetic"]);

test("an out-of-vocabulary mood is reported", () => {
  const report = newReport();
  checkDesignIndex(report, SYNTHETIC_SLUGS, syntheticIndex({ mood: ["neon"] }));
  assert.equal(report["index-mood-invalid"].length, 1);
});

test("a malformed hex, an unknown role and a bad confidence are each reported", () => {
  const report = newReport();
  checkDesignIndex(
    report,
    SYNTHETIC_SLUGS,
    syntheticIndex({
      palette: [{ hex: "not-a-hex", role: "sparkle", provenance: "p", confidence: "certain" }],
    }),
  );
  assert.equal(report["index-palette-invalid"].length, 3);
});

test("an out-of-scale density or motion level is reported", () => {
  const report = newReport();
  checkDesignIndex(report, SYNTHETIC_SLUGS, syntheticIndex({ density: "sideways" }));
  assert.equal(report["index-scale-invalid"].length, 1);
  const motion = newReport();
  checkDesignIndex(motion, SYNTHETIC_SLUGS, syntheticIndex({ motion_level: "turbo" }));
  assert.equal(motion["index-scale-invalid"].length, 1);
});

test("a malformed typography entry is reported", () => {
  const report = newReport();
  checkDesignIndex(
    report,
    SYNTHETIC_SLUGS,
    syntheticIndex({ typography: { body: { family: "X", confidence: "bogus" } } }),
  );
  assert.ok(report["index-typography-invalid"].length > 0);
});

test("a row with no corresponding template is reported as an orphan", () => {
  const report = newReport();
  checkDesignIndex(report, new Set(), syntheticIndex({}));
  assert.equal(report["index-row-orphan"].length, 1);
});

test("a row whose source hash has drifted is reported as stale", () => {
  const report = newReport();
  const { slugs } = checkTemplates(newReport());
  const realSlug = [...slugs][0]!;
  checkDesignIndex(
    report,
    new Set([realSlug]),
    syntheticIndex({ slug: realSlug, sourceHash: "f".repeat(64) }),
  );
  assert.equal(report["index-source-stale"].length, 1, "a drifted hash must be caught");
});

test("the report carries a slot for every design-index violation class", () => {
  const report = newReport();
  for (const key of [
    "index-file-missing",
    "index-row-missing",
    "index-row-orphan",
    "index-mood-invalid",
    "index-palette-invalid",
    "index-typography-invalid",
    "index-scale-invalid",
    "index-source-stale",
  ]) {
    assert.ok(Array.isArray(report[key as keyof Report]), `${key} is missing from newReport()`);
  }
});
