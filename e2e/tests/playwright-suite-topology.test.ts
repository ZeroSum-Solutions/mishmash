// Merge-lane enrollment guard for the UI P0 Playwright groups.
//
// A `[P0]` name prefix is a priority label, not a registration:
// `e2e/AGENTS.md` ("UI test stability rules") states plainly that a `[P0]` tag
// does not enroll a file, and `ci.yml`'s `ui_p0` job runs only what a
// `uiP0Groups` group lists. A regression case can therefore ship tagged `[P0]`,
// pass its own red/green proof, and still never run on the merge queue — the
// exact gap W1M.2 found for `ui/side-chat-mount-during-run.test.ts`.
//
// `validatePlaywrightSuiteTopology()` (run by `pnpm guard`) keeps the group
// lists and the coverage list agreeing with each other, but it cannot know
// which files SHOULD be enrolled. That judgement is a pin, and this file is
// where it lives.
//
// This is a repository-resource consistency check over the e2e suite topology
// and the `ui/` directory — no browser, no daemon — so it belongs in
// `e2e/tests/` rather than in `ui/`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  getUiP0Group,
  uiP0CiMatrix,
  validatePlaywrightSuiteTopology,
} from '../lib/playwright/suites.js';

const e2eDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Real-daemon run-lifecycle regressions that must run on every merge, and the
 * group whose CI shard has to carry them.
 *
 * Each entry is a case whose bug was a wrong verdict on a run that actually
 * succeeded — the wave bar "no Task failed for a turn that succeeded". Those
 * regressions are cheap to reintroduce from any run/message-lifecycle change,
 * so full-pool-only coverage (`workflow_dispatch` with `suite=full`) is too
 * late: it reports after the change has already merged.
 *
 * A file is added here when its red spec proved a run-truth defect. It is
 * removed only together with the case it pins.
 */
const MERGE_LANE_PINS = [
  { file: 'ui/real-daemon-run.test.ts', group: 'project-runtime' },
  { file: 'ui/amr-run-failure-recovery.test.ts', group: 'project-runtime' },
  { file: 'ui/run-failure-retraction.test.ts', group: 'project-runtime' },
  { file: 'ui/inferred-failure-retraction.test.ts', group: 'project-runtime' },
  { file: 'ui/side-chat-mount-during-run.test.ts', group: 'project-runtime' },
] as const;

describe('UI P0 merge-lane enrollment', () => {
  for (const pin of MERGE_LANE_PINS) {
    it(`runs ${pin.file} in the ${pin.group} merge lane`, () => {
      const group = getUiP0Group(pin.group);
      expect(group, `unknown UI P0 group ${pin.group}`).toBeDefined();
      expect(
        group?.files ?? [],
        `${pin.file} is not enrolled in the ${pin.group} group, so ci.yml's ui_p0 job never runs it`,
      ).toContain(pin.file);
    });

    it(`reaches ${pin.file} through the CI matrix`, () => {
      // `ui_p0` builds its matrix from `uiP0CiMatrix` and then runs
      // `scripts/playwright.ts run-ui-group <shard>`, so a group nothing
      // dispatches is as unenrolled as no group at all.
      const dispatched = uiP0CiMatrix.some((entry) => entry.shard === pin.group);
      expect(
        dispatched,
        `no ui_p0 CI matrix entry dispatches the ${pin.group} group`,
      ).toBe(true);
    });

    it(`keeps a case in ${pin.file} that the ${pin.group} grep selects`, () => {
      // Enrollment without a matching case is silent zero coverage: the group
      // runs the file, the grep selects nothing, and the shard reports green.
      const group = getUiP0Group(pin.group);
      const source = readFileSync(path.join(e2eDir, pin.file), 'utf8');
      const grep = new RegExp(group?.grep ?? '(?!)');
      const titles = [...source.matchAll(/^\s*test\(\s*(['"`])([^'"`]+)\1/gm)].map(
        (match) => match[2] ?? '',
      );
      expect(
        titles.filter((title) => grep.test(title)),
        `${pin.file} has no test title matching the ${pin.group} grep ${group?.grep ?? '<none>'}`,
      ).not.toEqual([]);
    });
  }

  it('keeps the group lists and the coverage list in agreement', () => {
    // The same check `pnpm guard` runs. Repeated here so a pin added above
    // fails on the missing coverage entry with the topology error text rather
    // than only in guard.
    expect(validatePlaywrightSuiteTopology()).toEqual([]);
  });
});
