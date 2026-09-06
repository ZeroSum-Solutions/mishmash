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
  { file: 'ui/real-daemon-run.test.ts', group: 'project-runtime-daemon' },
  { file: 'ui/amr-run-failure-recovery.test.ts', group: 'project-runtime-daemon' },
  { file: 'ui/run-failure-retraction.test.ts', group: 'project-runtime-daemon' },
  { file: 'ui/inferred-failure-retraction.test.ts', group: 'project-runtime-retraction' },
  { file: 'ui/side-chat-mount-during-run.test.ts', group: 'project-runtime-retraction' },
] as const;

/**
 * The former single `project-runtime` group set the CI wall clock: 549 s of
 * serial Playwright payload at one worker (run 34023927186, 2026-09-06) while
 * every other shard finished 3-6 min in. `inferred-failure-retraction` alone
 * was 264 s. The two halves below are balanced on those measured per-file
 * times INCLUDING the ~47 s critical-extras step the daemon half also runs
 * (~296 s retraction / ~253 s + 47 s daemon), so neither exceeds the
 * next-slowest shard. Coverage is unchanged: every former file appears in
 * exactly one half.
 * Rebalance from a fresh results.json when a file's cost moves; do not merge
 * the halves back.
 */
const PROJECT_RUNTIME_SHARDS = {
  'project-runtime-retraction': [
    'ui/inferred-failure-retraction.test.ts',
    'ui/side-chat-mount-during-run.test.ts',
    'ui/tab-stream-budget.test.ts',
  ],
  'project-runtime-daemon': [
    'ui/real-daemon-run.test.ts',
    'ui/run-failure-retraction.test.ts',
    'ui/amr-run-failure-recovery.test.ts',
    'ui/amr-logout-requires-relogin.test.ts',
    'ui/settings-local-cli-codex-fallback.test.ts',
  ],
} as const;

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

  it('splits the former project-runtime payload into two balanced shards that partition its files', () => {
    const seen = new Set<string>();
    for (const [name, files] of Object.entries(PROJECT_RUNTIME_SHARDS)) {
      const group = getUiP0Group(name);
      expect(group, `unknown UI P0 group ${name}`).toBeDefined();
      expect([...(group?.files ?? [])].sort()).toEqual([...files].sort());
      expect(group?.workers, `${name} must keep the one-worker discipline of the real-daemon files`).toBe(1);
      expect(uiP0CiMatrix.some((entry) => entry.shard === name), `no ui_p0 CI matrix entry dispatches ${name}`).toBe(true);
      for (const file of files) {
        expect(seen.has(file), `${file} is enrolled in two project-runtime shards`).toBe(false);
        seen.add(file);
      }
    }
    expect(getUiP0Group('project-runtime'), 'the unsplit project-runtime group must not come back').toBeUndefined();
  });

  it('refuses a file enrolled in two dispatched groups', () => {
    // Coverage is compared on deduplicated file sets, so without this check a
    // file could run twice per CI run and no gate would say so.
    const errors = validatePlaywrightSuiteTopology({
      groups: {
        a: { grep: 'x', files: ['ui/app.test.ts'] },
        b: { grep: 'x', files: ['ui/app.test.ts'] },
      },
      matrix: [{ name: 'a', shard: 'a' }, { name: 'b', shard: 'b' }],
      coverage: ['ui/app.test.ts'],
    });
    expect(errors).toContain('UI P0 CI matrix enrols ui/app.test.ts in 2 dispatched groups (a, b)');
  });

  it('keeps the group lists and the coverage list in agreement', () => {
    // The same check `pnpm guard` runs. Repeated here so a pin added above
    // fails on the missing coverage entry with the topology error text rather
    // than only in guard.
    expect(validatePlaywrightSuiteTopology()).toEqual([]);
  });
});
