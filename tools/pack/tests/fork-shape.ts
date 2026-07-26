import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function anyExists(...relativePaths: string[]): boolean {
  return relativePaths.some((relativePath) => existsSync(join(WORKSPACE_ROOT, relativePath)));
}

// tools/pack exists to package the Electron desktop shell. This fork removed
// `apps/desktop` and `apps/packaged`, and the root AGENTS.md says "Do not
// recreate or reference them" — so the cases guarded by these flags read
// directories that are gone by design, not by regression.
//
// These are conditions, not `.skip` and not a disabled CI step. The suite still
// runs in CI, so the ~220 cases that never touch the desktop shell keep their
// signal, and restoring the shell re-arms the guarded cases with no flag for
// anyone to remember.
//
// Deliberately ANY rather than ALL. A partial restore — one directory back, the
// other not — is a broken state, and the useful behaviour there is a red test
// naming the missing file, not a silent skip. Requiring all of them would treat
// "half restored" identically to "intentionally absent", which is the failure
// mode this guard exists to avoid.
//
// See tools/pack/AGENTS.md, "Dormant in this fork", for why the packaging source
// is retained rather than deleted.
export const DESKTOP_SHELL_PRESENT = anyExists(
  "apps/desktop/package.json",
  "apps/packaged/package.json",
);

// The release lane shipped the desktop builds and went with them. Same ANY rule:
// release-workflows.test.ts reads five workflow files, so any one of them coming
// back should run the case and let it report the rest.
export const RELEASE_WORKFLOWS_PRESENT = anyExists(
  ".github/workflows/release-beta.yml",
  ".github/workflows/release-beta-s.yml",
  ".github/workflows/release-preview.yml",
  ".github/workflows/release-prerelease.yml",
  ".github/workflows/release-stable.yml",
);
