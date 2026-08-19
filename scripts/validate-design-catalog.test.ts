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
