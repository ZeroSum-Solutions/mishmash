// `od backup create` / `od restore` -- the CLI surface for the backup engine
// (create.ts / restore.ts). Both operate directly on the resolved data
// directory (RUNTIME_DATA_DIR-equivalent) rather than going through the
// daemon's HTTP API, so a backup can be taken even when the daemon isn't
// running -- the same reasoning `od project handoff` documents for why CLI
// handlers live in their own module (unit-testable without cli.ts's
// import-time SUBCOMMAND_MAP dispatch).
//
// Every outcome -- success AND failure -- is written to STDOUT as a single
// JSON line. This intentionally differs from most other `od` subcommands
// (which send structured errors to stderr): a restore failure must name the
// exact corrupted archive class, and that message is the machine-checkable
// contract callers (including the wave verifier) rely on, so it always rides
// stdout rather than being split across two streams.
//
// NOTE: apps/daemon/src/cli.ts is outside this wave's write lease
// (docs/plans/waves/leases.json, W0), so these handlers are not yet wired
// into SUBCOMMAND_MAP -- see the wave's completion report for specifics.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from '../daemon-paths.js';
import { resolveProjectRootFromNestedModule } from '../project-root.js';
import { createBackupArchive } from './create.js';
import { restoreBackupArchive, RestoreError } from './restore.js';

interface CliResult {
  exitCode: number;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function projectRoot(): string {
  return resolveProjectRootFromNestedModule(path.dirname(fileURLToPath(import.meta.url)));
}

function resolvedDataDir(): string {
  return resolveDataDir(process.env.OD_DATA_DIR, projectRoot());
}

interface ParsedFlags {
  values: Record<string, string>;
  json: boolean;
  error?: string;
}

function parseFlags(args: string[], known: string[]): ParsedFlags {
  const values: Record<string, string> = {};
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg && known.includes(arg.replace(/^--/, ''))) {
      const key = arg.replace(/^--/, '');
      const value = args[++i];
      if (value === undefined) return { values, json, error: `${arg} requires a value` };
      values[key] = value;
    } else if (arg?.startsWith('-')) {
      return { values, json, error: `unknown option: ${arg}` };
    }
  }
  return { values, json };
}

const USAGE_BACKUP = `Usage:
  od backup create --out <archivePath> [--json]

Creates a full snapshot of the daemon's data directory (SQLite database via
SQLite's online-backup API, projects, library assets, memory, and a redacted
app-config) at <archivePath>. See docs/security/backup-secret-inventory.json
for exactly what is included and excluded.
`;

const USAGE_RESTORE = `Usage:
  od restore --archive <archivePath> [--json]

Restores a backup archive (see "od backup create") into the daemon's data
directory. Refuses to restore onto an existing payload -- restore into a
fresh OD_DATA_DIR.
`;

export async function runBackupCli(args: string[]): Promise<CliResult> {
  const sub = args[0];
  if (sub !== 'create') {
    writeJson({ ok: false, error: { code: 'BAD_SUBCOMMAND', message: `unknown "od backup" subcommand: ${sub ?? '<none>'}` } });
    process.stdout.write(USAGE_BACKUP);
    return { exitCode: 1 };
  }
  const flags = parseFlags(args.slice(1), ['out']);
  if (flags.error) {
    writeJson({ ok: false, error: { code: 'BAD_FLAGS', message: flags.error } });
    return { exitCode: 1 };
  }
  const outPath = flags.values.out;
  if (!outPath) {
    writeJson({ ok: false, error: { code: 'MISSING_FLAG', message: '--out <archivePath> is required' } });
    process.stdout.write(USAGE_BACKUP);
    return { exitCode: 1 };
  }
  try {
    const result = await createBackupArchive({ dataDir: resolvedDataDir(), outPath: path.resolve(outPath) });
    writeJson({ ok: true, archivePath: result.archivePath, classes: result.manifest.map((e) => e.class) });
    return { exitCode: 0 };
  } catch (err) {
    writeJson({ ok: false, error: { code: 'BACKUP_FAILED', message: err instanceof Error ? err.message : String(err) } });
    return { exitCode: 1 };
  }
}

export async function runRestoreCli(args: string[]): Promise<CliResult> {
  const flags = parseFlags(args, ['archive']);
  if (flags.error) {
    writeJson({ ok: false, error: { code: 'BAD_FLAGS', message: flags.error } });
    return { exitCode: 1 };
  }
  const archivePath = flags.values.archive;
  if (!archivePath) {
    writeJson({ ok: false, error: { code: 'MISSING_FLAG', message: '--archive <archivePath> is required' } });
    process.stdout.write(USAGE_RESTORE);
    return { exitCode: 1 };
  }
  try {
    const result = await restoreBackupArchive({ archivePath: path.resolve(archivePath), dataDir: resolvedDataDir() });
    writeJson({ ok: true, restoredClasses: result.restoredClasses, destination: result.destination });
    return { exitCode: 0 };
  } catch (err) {
    if (err instanceof RestoreError) {
      writeJson({ ok: false, error: { code: 'RESTORE_FAILED', class: err.corruptedClass, message: err.message } });
    } else {
      writeJson({ ok: false, error: { code: 'RESTORE_FAILED', message: err instanceof Error ? err.message : String(err) } });
    }
    return { exitCode: 1 };
  }
}
