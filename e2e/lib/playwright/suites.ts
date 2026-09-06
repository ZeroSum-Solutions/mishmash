export type UiPlaywrightGroup = {
  files: readonly string[];
  grep: string;
  workers?: number;
};

export type UiP0CiMatrixEntry = {
  name: string;
  shard: string;
};

export type VisualCiMatrixEntry = {
  files: string;
  name: string;
};

export const uiP0Groups = {
  "critical-extras": {
    grep: "@merge-extra",
    workers: 1,
    files: ["ui/app.test.ts"],
  },
  "workspace-restoration": {
    grep: String.raw`\[P0\]`,
    files: [
      "ui/app-restoration.test.ts",
      "ui/client-interview-flow.test.ts",
      "ui/critical-smoke.test.ts",
    ],
  },
  // Split out of the former single `entry-settings` group (2026-08-04). That
  // group was the CI critical path at ~11.8m of test payload while every other
  // shard finished in 8-9m, so it alone set wall-clock. The two halves below
  // are balanced on measured per-file time from run 30977989376
  // (~313s entry-chrome / ~394s settings-onboarding), which drops both under
  // the next-slowest shard. Coverage is unchanged — every file from the old
  // group appears in exactly one half, enforced by
  // validatePlaywrightSuiteTopology().
  "entry-chrome": {
    grep: String.raw`\[P0\]`,
    files: [
      "ui/entry-chrome-flows.test.ts",
      "ui/entry-configuration-flows.test.ts",
      "ui/api-empty-response.test.ts",
      "ui/message-center-no-upstream.test.ts",
      "ui/typeface-specimens.test.ts",
    ],
  },
  "settings-onboarding": {
    grep: String.raw`\[P0\]`,
    files: [
      "ui/amr-onboarding.test.ts",
      "ui/settings-api-protocol.test.ts",
      "ui/settings-connectors-auth-happy-path.test.ts",
      "ui/settings-connectors-auth-recovery.test.ts",
    ],
  },
  "project-workspace": {
    grep: String.raw`\[P0\]`,
    workers: 1,
    files: [
      "ui/app.test.ts",
      "ui/app-design-files.test.ts",
      "ui/app-manual-edit.test.ts",
      "ui/canvas-preview-inline-flicker.test.ts",
      "ui/preview-runtime-script.test.ts",
      "ui/project-management-flows.test.ts",
      "ui/template-entry-file-shim.test.ts",
      "ui/workspace-keyboard-flows.test.ts",
    ],
  },
  // Split out of the former single `project-runtime` group (2026-09-06). That
  // group had become the CI critical path at 549 s of serial payload (one
  // worker) while every other shard finished 3-6 min in; run 34023927186
  // measured inferred-failure-retraction alone at 264 s. The halves are
  // balanced on those per-file times with the ~47 s critical-extras step the
  // daemon half also runs counted in (~296 s retraction / ~253 s + 47 s daemon).
  // Coverage is unchanged and `e2e/tests/playwright-suite-topology.test.ts`
  // pins the partition; validatePlaywrightSuiteTopology() pins coverage.
  "project-runtime-retraction": {
    grep: String.raw`\[P0\]`,
    workers: 1,
    files: [
      "ui/inferred-failure-retraction.test.ts",
      "ui/side-chat-mount-during-run.test.ts",
      "ui/tab-stream-budget.test.ts",
    ],
  },
  "project-runtime-daemon": {
    grep: String.raw`\[P0\]`,
    workers: 1,
    files: [
      "ui/real-daemon-run.test.ts",
      "ui/run-failure-retraction.test.ts",
      "ui/amr-run-failure-recovery.test.ts",
      "ui/amr-logout-requires-relogin.test.ts",
      "ui/settings-local-cli-codex-fallback.test.ts",
    ],
  },
} as const satisfies Record<string, UiPlaywrightGroup>;

export type UiP0GroupName = keyof typeof uiP0Groups;

export const uiP0CiMatrix = [
  { name: "entry-chrome", shard: "entry-chrome" },
  { name: "settings-onboarding", shard: "settings-onboarding" },
  { name: "project-workspace", shard: "project-workspace" },
  { name: "project-runtime-retraction", shard: "project-runtime-retraction" },
  { name: "project-runtime-daemon", shard: "project-runtime-daemon" },
  { name: "workspace-restoration", shard: "workspace-restoration" },
] as const satisfies readonly UiP0CiMatrixEntry[];

export const visualCiMatrix = [
  { name: "entry-navigation", files: "ui/visual-entry.test.ts ui/visual-navigation.test.ts" },
  { name: "settings-workspace", files: "ui/visual-settings.test.ts ui/visual-workspace.test.ts" },
] as const satisfies readonly VisualCiMatrixEntry[];

const uiP0CoverageFiles = [
  "ui/amr-logout-requires-relogin.test.ts",
  "ui/amr-onboarding.test.ts",
  "ui/amr-run-failure-recovery.test.ts",
  "ui/api-empty-response.test.ts",
  "ui/app-design-files.test.ts",
  "ui/app-manual-edit.test.ts",
  "ui/app-restoration.test.ts",
  "ui/app.test.ts",
  "ui/canvas-preview-inline-flicker.test.ts",
  "ui/client-interview-flow.test.ts",
  "ui/critical-smoke.test.ts",
  "ui/entry-chrome-flows.test.ts",
  "ui/entry-configuration-flows.test.ts",
  "ui/inferred-failure-retraction.test.ts",
  "ui/message-center-no-upstream.test.ts",
  "ui/preview-runtime-script.test.ts",
  "ui/project-management-flows.test.ts",
  "ui/real-daemon-run.test.ts",
  "ui/run-failure-retraction.test.ts",
  "ui/settings-api-protocol.test.ts",
  "ui/settings-connectors-auth-happy-path.test.ts",
  "ui/settings-connectors-auth-recovery.test.ts",
  "ui/settings-local-cli-codex-fallback.test.ts",
  "ui/side-chat-mount-during-run.test.ts",
  "ui/tab-stream-budget.test.ts",
  "ui/template-entry-file-shim.test.ts",
  "ui/typeface-specimens.test.ts",
  "ui/workspace-keyboard-flows.test.ts",
] as const;

export function getUiP0Group(name: string): UiPlaywrightGroup | undefined {
  return uiP0Groups[name as UiP0GroupName];
}

export function listUiP0GroupNames(): string[] {
  return Object.keys(uiP0Groups).sort();
}

/** The pieces the validator judges; defaults to the live topology above. */
export interface PlaywrightSuiteTopology {
  groups: Record<string, UiPlaywrightGroup>;
  matrix: readonly UiP0CiMatrixEntry[];
  coverage: readonly string[];
}

export function validatePlaywrightSuiteTopology(
  topology: PlaywrightSuiteTopology = { groups: uiP0Groups, matrix: uiP0CiMatrix, coverage: uiP0CoverageFiles },
): string[] {
  const errors: string[] = [];
  const { groups, matrix, coverage } = topology;
  const knownGroups = new Set(Object.keys(groups));
  const coverageFiles = sortedUnique(coverage);
  const shards = matrix.map((entry) => entry.shard);
  const ciFiles = sortedUnique(shards.flatMap((name) => groups[name]?.files ?? []));

  for (const entry of matrix) {
    if (!knownGroups.has(entry.shard)) {
      errors.push(`UI P0 CI matrix references unknown group ${entry.shard}`);
    }
  }

  // A file enrolled in two dispatched groups runs twice per CI run and, since
  // coverage is compared on deduplicated sets, nothing else would say so.
  const enrolledIn = new Map<string, string[]>();
  for (const name of shards) {
    for (const file of groups[name]?.files ?? []) {
      enrolledIn.set(file, [...(enrolledIn.get(file) ?? []), name]);
    }
  }
  for (const [file, names] of enrolledIn) {
    if (names.length > 1) {
      errors.push(`UI P0 CI matrix enrols ${file} in ${names.length} dispatched groups (${names.join(', ')})`);
    }
  }

  for (const file of difference(coverageFiles, ciFiles)) {
    errors.push(`UI P0 CI matrix does not cover ${file}`);
  }

  for (const file of difference(ciFiles, coverageFiles)) {
    errors.push(`UI P0 CI matrix unexpectedly covers ${file}`);
  }

  for (const entry of visualCiMatrix) {
    if (entry.files.trim().length === 0) {
      errors.push(`Visual CI matrix entry ${entry.name} has no files`);
    }
  }

  return errors;
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
