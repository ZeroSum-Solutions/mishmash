import { join } from 'node:path';

import { sweepStaleE2eArtifacts } from './artifact-retention.ts';
import { e2eWorkspaceRoot } from './tools-dev/runtime.ts';

// Shared globalSetup for the Playwright configs and Vitest. Both suites create
// per-run directories under .tmp/e2e (playwright/suite.ts, vitest/suite.ts)
// with no teardown, so crashed or killed runs accumulate artifacts without
// bound. Sweeping at run start instead of teardown means crashes can never
// leak: whatever a dead run left behind is collected by the next run, while
// anything younger than the retention window stays debuggable.
export default async function sweepStaleArtifactsBeforeRun(): Promise<void> {
  await sweepStaleE2eArtifacts({ artifactRoot: join(e2eWorkspaceRoot(), '.tmp', 'e2e') });
}
