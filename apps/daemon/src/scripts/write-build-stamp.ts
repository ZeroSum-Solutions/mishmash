// W8C item 3: run after `tsc` by the daemon's `build` script
// (`apps/daemon/package.json`) to write `dist/build-stamp.json`, sibling to
// `dist/cli.js`. Kept dependency-free beyond Node builtins so it survives a
// plain compile with no extra install step.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownDir = dirname(fileURLToPath(import.meta.url));

function readCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: ownDir, encoding: 'utf8' }).trim();
  } catch {
    // A tarball install or a `.git`-less checkout must not fail the build.
    return 'unknown';
  }
}

const stamp = {
  commit: readCommit(),
  builtAt: new Date().toISOString(),
};

writeFileSync(join(ownDir, '..', 'build-stamp.json'), JSON.stringify(stamp));
