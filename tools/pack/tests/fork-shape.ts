import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// tools/pack exists to package the Electron desktop shell. This fork removed
// `apps/desktop` and `apps/packaged`, and the root AGENTS.md says "Do not
// recreate or reference them" — so the cases below read directories that are
// gone by design, not by regression.
//
// These are conditions, not `.skip` and not a disabled CI step. The distinction
// matters: the suite still runs in CI, so the ~220 cases that do not touch the
// desktop shell keep their signal, and restoring the shell re-arms every guarded
// case automatically instead of waiting for someone to remember a flag. A
// half-restore — one directory back, the other not — turns them red rather than
// leaving them quietly off.
//
// See tools/pack/AGENTS.md, "Dormant in this fork", for why the packaging source
// is retained rather than deleted.
export const DESKTOP_SHELL_PRESENT =
  existsSync(join(WORKSPACE_ROOT, "apps/desktop/package.json")) &&
  existsSync(join(WORKSPACE_ROOT, "apps/packaged/package.json"));

// The beta release lane shipped the mac desktop build and went with it.
export const BETA_RELEASE_WORKFLOW_PRESENT = existsSync(
  join(WORKSPACE_ROOT, ".github/workflows/release-beta.yml"),
);
