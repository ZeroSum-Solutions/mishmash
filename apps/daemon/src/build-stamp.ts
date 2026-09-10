// W8C item 3: reads the build stamp `write-build-stamp.ts` writes next to
// `dist/cli.js` at build time, so `/api/health` and `od --version` can both
// report the exact commit and build time the running `dist` was built from.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BuildStamp {
  commit: string;
  builtAt: string;
}

const UNKNOWN_STAMP: BuildStamp = { commit: 'unknown', builtAt: 'unknown' };

function ownCompiledDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

// Keyed by the resolved directory rather than one bare module-level value:
// the file never changes for the life of a real daemon process (which always
// reads its own compiled directory, so this caches to exactly one entry in
// production), but the daemon's own tests read several different fixture
// directories in one process and must never see one directory's stamp
// leak into another's.
const cache = new Map<string, BuildStamp>();

/**
 * Must hold: never throws. Returns the parsed `{commit, builtAt}` from
 * `<dir ?? own compiled dirname>/build-stamp.json` on a valid read, and
 * `{commit: 'unknown', builtAt: 'unknown'}` on any failure -- a missing
 * file (no build stamp was ever written, e.g. running from source),
 * malformed JSON, or non-string fields.
 */
export function readBuildStamp(dir?: string): BuildStamp {
  const resolvedDir = dir ?? ownCompiledDir();
  const cached = cache.get(resolvedDir);
  if (cached) return cached;

  let stamp: BuildStamp = UNKNOWN_STAMP;
  try {
    const raw: unknown = JSON.parse(readFileSync(join(resolvedDir, 'build-stamp.json'), 'utf8'));
    if (
      raw !== null
      && typeof raw === 'object'
      && typeof (raw as { commit?: unknown }).commit === 'string'
      && typeof (raw as { builtAt?: unknown }).builtAt === 'string'
    ) {
      stamp = { commit: (raw as { commit: string }).commit, builtAt: (raw as { builtAt: string }).builtAt };
    }
  } catch {
    stamp = UNKNOWN_STAMP;
  }

  cache.set(resolvedDir, stamp);
  return stamp;
}
