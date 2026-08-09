import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ALL_SEED_FIXTURES, fixtureRoot, sourceLabel } from "./seed-test-projects.ts";

// `scripts/seed-test-projects.ts` copies a fixture's on-disk folder into a new
// seeded project. It resolved every `sourceKind: 'skill'` fixture under
// `skills/<id>`, but skill-like ids live under EITHER `skills/` or
// `design-templates/` — the daemon spans both (ALL_SKILL_LIKE_ROOTS in
// apps/daemon/src/server.ts, read through listAllSkillLikeEntries). All six
// skill fixtures name design-templates, so all six resolved to a path that does
// not exist, and the script reported a per-fixture failure at copy time instead
// of anything pointing at the real cause.
//
// This file is the guard that would have caught it: a resolved fixture root must
// exist. It deliberately checks the RESOLVED path rather than re-deriving one,
// so it fails if either fixtureRoot() or the fixture table drifts.
//
// Not imported from the daemon on purpose: scripts/check-cross-app-imports.ts
// forbids reaching into apps/daemon/src/**. This mirrors the daemon's multi-root
// semantics for the two repo-owned roots; the daemon's other two roots are
// runtime-data dirs that hold no repo fixtures.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every seed fixture resolves to a folder that exists on disk", () => {
  const missing = ALL_SEED_FIXTURES.filter((fix) => !existsSync(fixtureRoot(fix))).map(
    (fix) => `${fix.sourceKind}:${fix.skillId} -> ${path.relative(REPO_ROOT, fixtureRoot(fix))}`,
  );

  assert.deepEqual(
    missing,
    [],
    `${missing.length} of ${ALL_SEED_FIXTURES.length} seed fixtures resolve to a non-existent folder`,
  );
});

test("sourceLabel describes the same folder fixtureRoot resolves to", () => {
  // The label is what a failure prints, so a label that disagrees with the real
  // path sends whoever reads it to the wrong directory.
  const mismatched = ALL_SEED_FIXTURES.filter(
    (fix) => path.resolve(REPO_ROOT, sourceLabel(fix)) !== fixtureRoot(fix),
  ).map((fix) => `${fix.skillId}: label=${sourceLabel(fix)} root=${path.relative(REPO_ROOT, fixtureRoot(fix))}`);

  assert.deepEqual(mismatched, []);
});
