// Negative-control coverage for the C0-11 capability-manifest / CLI parity
// guard check (scripts/guard.ts: validateCapabilityManifestRowShape,
// extractSubcommandMapKeysFromCliSource, extractCliApiRoutesByNamespace,
// checkCapabilityManifestParityCore -- wired in as the "capability manifest
// parity" entry in the `checks` array run by `pnpm guard`).
//
// scripts/guard.ts sits outside apps/daemon's tsconfig rootDir, so its
// check functions can't be imported directly from a daemon test without
// breaking `tsc -p apps/daemon/tsconfig.tests.json --noEmit`'s rootDir
// boundary. Instead, each test here temporarily mutates the REAL fixture
// files the check reads (scripts/waves/capability-manifest.json and
// apps/daemon/src/cli.ts), runs the real `tsx scripts/guard.ts` subprocess
// (the same mechanism `pnpm guard` uses), and asserts on its real exit code
// and stderr -- real-transport coverage of the check as it actually runs,
// not a mock of its internals. `afterEach` always restores both files from
// a `beforeEach` snapshot, regardless of which test ran or whether it
// passed, since these are real repo source files rather than throwaway
// fixtures.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const guardScriptPath = path.join(repoRoot, 'scripts/guard.ts');
const tsxBinPath = path.join(repoRoot, 'node_modules/.bin/tsx');
const manifestPath = path.join(repoRoot, 'scripts/waves/capability-manifest.json');
const cliSourcePath = path.join(repoRoot, 'apps/daemon/src/cli.ts');

let originalManifest: string;
let originalCliSource: string;

beforeEach(() => {
  originalManifest = readFileSync(manifestPath, 'utf8');
  originalCliSource = readFileSync(cliSourcePath, 'utf8');
});

afterEach(() => {
  // Always restore -- even if a test's assertion threw mid-way -- these are
  // real repo source files, not throwaway fixtures.
  writeFileSync(manifestPath, originalManifest);
  writeFileSync(cliSourcePath, originalCliSource);
});

interface GuardRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runGuard(): GuardRunResult {
  try {
    const stdout = execFileSync(tsxBinPath, [guardScriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('capability manifest parity guard check (C0-11)', () => {
  it('(control) passes on the unmodified tree -- proves the check is green at HEAD', () => {
    const result = runGuard();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Capability manifest parity check passed');
  }, 60_000);

  it('fails, naming the field, when a manifest row is missing a required field (shape violation)', () => {
    const manifest = JSON.parse(originalManifest) as Array<Record<string, unknown>>;
    const configRow = manifest.find((row) => row.capability === 'config');
    expect(configRow).toBeTruthy();
    delete (configRow as Record<string, unknown>).cliArgs;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const result = runGuard();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Capability manifest parity check failed');
    expect(result.stderr).toContain('capability: "config"');
    expect(result.stderr).toContain('cliArgs');
    expect(result.stderr).toContain('must be a non-empty string array');
  }, 60_000);

  it('fails, naming the delta, when the manifest and SUBCOMMAND_MAP capability sets diverge (set mismatch)', () => {
    const manifest = JSON.parse(originalManifest) as Array<Record<string, unknown>>;
    const withoutConfig = manifest.filter((row) => row.capability !== 'config');
    expect(withoutConfig.length).toBe(manifest.length - 1);
    writeFileSync(manifestPath, `${JSON.stringify(withoutConfig, null, 2)}\n`);

    const result = runGuard();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Capability manifest parity check failed');
    expect(result.stderr).toContain(
      'capability-manifest.json is missing a row for SUBCOMMAND_MAP capabilities: config',
    );
  }, 60_000);

  it('fails, naming the route, when cli.ts reaches a route no manifest row documents (unmanifested route addition)', () => {
    // A dead branch is enough -- the check statically scans source text for
    // fetch() calls, it never executes cli.ts, so this never actually runs.
    const mutatedCli = `${originalCliSource}\nif (false) { fetch('/api/guard-check-negative-control-route'); }\n`;
    writeFileSync(cliSourcePath, mutatedCli);

    const result = runGuard();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Capability manifest parity check failed');
    expect(result.stderr).toContain('GET /api/guard-check-negative-control-route');
    expect(result.stderr).toContain(
      'namespace "guard-check-negative-control-route" has no capability-manifest.json row at all',
    );
  }, 60_000);
});
