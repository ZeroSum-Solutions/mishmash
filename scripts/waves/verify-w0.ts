// verify-w0.ts -- wave W0 (substrate: recovery, boundary, baselines) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w0.ts
// Exit 0 only when every C0 criterion passes and the tree is clean; the
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way (VERIFICATION-CONTRACT.md section 2).
//
// This verifier is written BEFORE the wave is implemented (contract section
// 1: "every wave ships a verifier before it ships an implementation"), so it
// defines the exact contracts the implementation must satisfy:
//
//   scripts/waves/probe-w0-restore.ts
//     `pnpm exec tsx scripts/waves/probe-w0-restore.ts --mode=<mode> --json`
//     Last non-empty stdout line is one JSON object. Modes:
//       snapshot-restore     -> { integrityCheck: "ok"|string, sampledFiles: number,
//                                 sampledFileMismatches: number,
//                                 assetFetch: { status: number, sha256Match: boolean },
//                                 daemonBooted: boolean }
//       concurrent-mutation  -> { referentialConsistency: "ok"|string, orphanRows: number,
//                                 staleFiles: number, mutationWriteCount: number,
//                                 mutationDurationMs: number }
//       corrupt --target=<db-page|project-file|manifest-entry>
//                             -> process MUST exit non-zero; stdout JSON:
//                                { detected: boolean, corruptionKind: string }
//
//   scripts/waves/capability-manifest.json
//     CapabilityManifestEntry[] (see type below), the real UI/CLI parity
//     inventory this wave commits.
//
//   scripts/waves/probe-w0-parity.ts
//     `pnpm exec tsx scripts/waves/probe-w0-parity.ts --manifest <path> --json`
//     Last non-empty stdout line: { results: { capability: string,
//     status: "pass"|"fail", reason?: string }[], allPass: boolean }.
//     Must run against an arbitrary --manifest path, not just the committed
//     one -- the red-control check below feeds it a synthetic bad manifest.
//
//   scripts/waves/probe-w0-guard-parity-fixture.ts
//     `pnpm exec tsx scripts/waves/probe-w0-guard-parity-fixture.ts --json`
//     Adds a capability to one surface only, proves `pnpm guard` fails, then
//     reverts and proves it passes again -- entirely self-contained (no
//     leftover working-tree changes). Last stdout line: { addedCapabilityBrokeGuard:
//     boolean, revertedCleanly: boolean, guardPassesAfterRevert: boolean }.
//
//   docs/security/backup-secret-inventory.json
//     SecretClassEntry[] (see REQUIRED_CLASSES below).
//
//   apps/daemon/src/security/privileged-routes.json
//     { method: string, path: string }[] -- the frozen privileged-route
//     inventory C0-7 must iterate in full.
//
//   docs/security/daemon-threat-model.md, docs/testing/scale-baseline-2026-07.md,
//   docs/security/stored-identity-inventory.md, docs/testing/daemon-failure-inventory.md
//     Committed documents with structural requirements asserted below.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const proofDir = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w0-substrate', 'proof');
fs.mkdirSync(proofDir, { recursive: true });

function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 15 * 60_000,
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: 'pass' | 'fail';
  detail?: string | undefined;
}

// Never throws: a proof-manifest run that took 20-40 minutes must not be lost
// because the LAST step (writing one criterion's evidence file) hit a
// filesystem error. Falls back to os.tmpdir(), then to no artifact at all --
// the criterion result itself is always still recorded.
function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string | null } {
  const primary = path.join(proofDir, `${id}.txt`);
  try {
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(primary, content);
    return { artifact: primary, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
  } catch (primaryErr) {
    try {
      const fallbackDir = path.join(os.tmpdir(), 'verify-w0-fallback-proof');
      fs.mkdirSync(fallbackDir, { recursive: true });
      const fallback = path.join(fallbackDir, `${id}.txt`);
      fs.writeFileSync(fallback, `${content}\n\n[fallback write: primary path ${primary} failed: ${String(primaryErr)}]\n`);
      return { artifact: fallback, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
    } catch (fallbackErr) {
      console.error(`verify-w0: artifact write failed for ${id} (primary: ${String(primaryErr)}; fallback: ${String(fallbackErr)}) -- recording the result without an artifact file`);
      return { artifact: null, artifactSha256: null };
    }
  }
}

const results: CriterionResult[] = [];
// Never throws, for the same reason as artifactFor: a probe result must
// always land in `results` so the manifest reflects reality even if
// something unexpected happens while assembling this criterion's evidence.
function record(id: string, command: string, assertion: string, ok: boolean, evidence: string, detail?: string): void {
  try {
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${detail ? `# detail: ${detail}\n` : ''}\n${evidence}\n`,
    );
    results.push({ id, command, assertion, artifact, artifactSha256, exitCode: ok ? 0 : 1, status: ok ? 'pass' : 'fail', detail });
  } catch (err) {
    results.push({
      id,
      command,
      assertion,
      artifact: null,
      artifactSha256: null,
      exitCode: 1,
      status: 'fail',
      detail: `record() itself failed: ${String(err)}${detail ? ` (original detail: ${detail})` : ''}`,
    });
  }
}

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel));
}

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseLastJsonLine(stdout: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.length > 0 ? lines[lines.length - 1] : undefined;
  if (!last) return { ok: false, error: 'probe produced no stdout' };
  try {
    return { ok: true, value: JSON.parse(last) };
  } catch (err) {
    return { ok: false, error: `last stdout line is not valid JSON (${String(err)}): ${last.slice(0, 300)}` };
  }
}

// -----------------------------------------------------------------------
// Hardened git plumbing, resolved eagerly before any expensive suite run.
//
// Every git call here has its exit status checked explicitly -- a failed or
// empty result is never silently treated as "no commit" / "no changes".
// This runs BEFORE the ~20-40 minute daemon+web suite pass below so a
// broken git environment fails in seconds, not after burning the whole
// verifier budget. If it fails, an emergency manifest is still written
// (commit-bound proof is the whole point of this file) before exiting.
// -----------------------------------------------------------------------

function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  }
  return r.stdout.trim();
}

// Prefers the live remote tip (`git ls-remote`, a network call that needs no
// local fetch) to detect a stale local ref, but still resolves the merge-base
// against a LOCAL ref (origin/main, falling back to main) since merge-base
// needs the commit object present locally. A mismatch is recorded as a
// warning, not a hard failure -- a stale local ref is common in a worktree
// and should not, by itself, block verification.
function resolveMainRef(): { ref: string; sha: string; warning: string | undefined } {
  const remoteHead = sh('git', ['ls-remote', 'origin', 'main']);
  const remoteSha = remoteHead.status === 0 ? (remoteHead.stdout.trim().split(/\s+/)[0] ?? '') : '';
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) {
      const sha = verify.stdout.trim();
      const stale = remoteSha.length > 0 && sha !== remoteSha;
      const warning = stale
        ? `local ref "${ref}" (${sha.slice(0, 12)}) does not match live origin/main tip (${remoteSha.slice(0, 12)} via git ls-remote) -- consider fetching`
        : remoteSha.length === 0
          ? '"git ls-remote origin main" did not resolve; used a local ref without a live comparison'
          : undefined;
      return { ref, sha, warning };
    }
  }
  throw new Error('could not resolve "origin/main" or "main" locally to compute baseCommit');
}

function writeEmergencyManifest(errorMessage: string): void {
  fs.mkdirSync(proofDir, { recursive: true });
  const manifest = {
    wave: 'W0',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git ls-remote origin main / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty commits before any criterion runs',
        artifact: null,
        artifactSha256: null,
        exitCode: 1,
        status: 'fail',
        detail: errorMessage,
      },
    ],
  };
  fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.error(`verify-w0: FATAL git resolution failure, wrote emergency manifest: ${errorMessage}`);
}

function resolveGitContextOrExit(): { headSha: string; baseCommit: string; mainRefWarning: string | undefined } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRef();
    const resolvedBaseCommit = gitOrFail(['merge-base', mainRef.sha, resolvedHeadSha], 'computing baseCommit');
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit, mainRefWarning: mainRef.warning };
  } catch (err) {
    writeEmergencyManifest(String(err));
    process.exit(1);
  }
}

const { headSha, baseCommit, mainRefWarning } = resolveGitContextOrExit();
if (mainRefWarning) console.warn(`verify-w0: ⚠ ${mainRefWarning}`);

// -----------------------------------------------------------------------
// Shared expensive runs: reused across multiple criteria so a full daemon
// suite pass (fileParallelism: false, ~380 files) and a full web suite pass
// only happen once each, no matter how many criteria read their output.
// -----------------------------------------------------------------------

interface AssertionResult { fullName: string; status: string }
interface SuiteJson { numFailedTests: number; numPassedTests: number; testResults: { assertionResults: AssertionResult[] }[] }

function runSuiteJson(pkg: string, outFile: string): { runResult: ReturnType<typeof sh>; data: SuiteJson | null; all: AssertionResult[] } {
  const outPath = path.join(proofDir, outFile);
  const runResult = sh('pnpm', ['--filter', pkg, 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${outPath}`], {
    timeoutMs: 30 * 60_000,
  });
  let data: SuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as SuiteJson;
  } catch {
    data = null;
  }
  const all: AssertionResult[] = data ? data.testResults.flatMap((t) => t.assertionResults) : [];
  return { runResult, data, all };
}

const daemonSuite = runSuiteJson('@open-design/daemon', 'daemon-suite-run.json');
const webSuite = runSuiteJson('@open-design/web', 'web-suite-run.json');

function daemonMatching(needle: string): AssertionResult[] {
  return daemonSuite.all.filter((t) => t.fullName.includes(needle));
}
function needleReport(needle: string, minimum: number): { ok: boolean; evidence: string } {
  const hits = daemonMatching(needle);
  const passed = hits.filter((t) => t.status === 'passed');
  const ok = hits.length >= minimum && hits.every((t) => t.status === 'passed');
  return {
    ok,
    evidence: hits.length
      ? hits.map((t) => `${t.status.toUpperCase()}  ${t.fullName}`).join('\n')
      : `NO TESTS MATCHED "${needle}" (want >=${minimum}) -- missing evidence counts as a fail, not a pass`,
  };
}

// =========================================================================
// C0-1 / C0-2 / C0-3 -- backup + restore, via scripts/waves/probe-w0-restore.ts
// =========================================================================

const probeRestoreRel = 'scripts/waves/probe-w0-restore.ts';
const probeRestoreExists = fileExists(probeRestoreRel);

function runRestoreProbe(args: string[], timeoutMs = 10 * 60_000): { status: number; stdout: string } {
  return sh('pnpm', ['exec', 'tsx', probeRestoreRel, ...args], { timeoutMs });
}

// --- C0-1 ---
let c01SnapshotRun: { status: number; stdout: string } | null = null;
{
  const cmd = `pnpm exec tsx ${probeRestoreRel} --mode=snapshot-restore --json`;
  const assertion =
    'restore into fresh OD_DATA_DIR: PRAGMA integrity_check == ok, >=20 sampled project files content-hash-equal, ' +
    'restored daemon boots, HTTP fetch of a restored asset returns body sha256 matching source';
  if (!probeRestoreExists) {
    record('C0-1', cmd, assertion, false, '', `missing: ${probeRestoreRel} -- see header comment for the required --mode=snapshot-restore JSON contract`);
  } else {
    const run = runRestoreProbe(['--mode=snapshot-restore', '--json']);
    c01SnapshotRun = run;
    const parsed = parseLastJsonLine(run.stdout);
    if (!parsed.ok) {
      record('C0-1', cmd, assertion, false, run.stdout, parsed.error);
    } else {
      const v = parsed.value;
      const assetFetch = isRecord(v) && isRecord(v.assetFetch) ? v.assetFetch : {};
      const checks = {
        processExitedZero: run.status === 0,
        integrityCheckOk: isRecord(v) && v.integrityCheck === 'ok',
        sampledFilesAtLeast20: isRecord(v) && typeof v.sampledFiles === 'number' && v.sampledFiles >= 20,
        zeroMismatches: isRecord(v) && typeof v.sampledFileMismatches === 'number' && v.sampledFileMismatches === 0,
        assetFetchStatus200: assetFetch.status === 200,
        assetFetchShaMatches: assetFetch.sha256Match === true,
        daemonBooted: isRecord(v) && v.daemonBooted === true,
      };
      const ok = Object.values(checks).every(Boolean);
      record('C0-1', cmd, assertion, ok, JSON.stringify({ checks, raw: v }, null, 2), ok ? undefined : `failing checks: ${Object.entries(checks).filter(([, v2]) => !v2).map(([k]) => k).join(', ')}`);
    }
  }
}

// --- C0-2 ---
{
  const cmd = `pnpm exec tsx ${probeRestoreRel} --mode=concurrent-mutation --json`;
  const assertion =
    'backup taken while a real writer loop mutates SQLite + project files stays referentially consistent (0 orphan rows, ' +
    '0 stale files), and the backup implementation uses SQLite online-backup rather than a raw file copy';
  if (!probeRestoreExists) {
    record('C0-2', cmd, assertion, false, '', `missing: ${probeRestoreRel}`);
  } else {
    const run = runRestoreProbe(['--mode=concurrent-mutation', '--json']);
    const parsed = parseLastJsonLine(run.stdout);
    // Static check: the backup implementation must show evidence of SQLite's
    // online-backup API (or VACUUM INTO), not a naive fs.copyFile of the db
    // file -- a plain copy is exactly what C0-2 exists to rule out.
    const backupDir = path.join(repoRoot, 'apps/daemon/src/backup');
    let onlineBackupEvidence = false;
    let backupSourceFiles: string[] = [];
    if (fs.existsSync(backupDir)) {
      backupSourceFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith('.ts'));
      onlineBackupEvidence = backupSourceFiles.some((f) => {
        const text = fs.readFileSync(path.join(backupDir, f), 'utf8');
        return /\.backup\s*\(|VACUUM\s+INTO/i.test(text);
      });
    }
    if (!parsed.ok) {
      record('C0-2', cmd, assertion, false, run.stdout, `${parsed.error}; onlineBackupEvidence=${onlineBackupEvidence}`);
    } else {
      const v = parsed.value;
      const checks = {
        processExitedZero: run.status === 0,
        referentialConsistencyOk: isRecord(v) && v.referentialConsistency === 'ok',
        zeroOrphanRows: isRecord(v) && typeof v.orphanRows === 'number' && v.orphanRows === 0,
        zeroStaleFiles: isRecord(v) && typeof v.staleFiles === 'number' && v.staleFiles === 0,
        realWriterLoopRan: isRecord(v) && typeof v.mutationWriteCount === 'number' && v.mutationWriteCount >= 50,
        writerLoopHadDuration: isRecord(v) && typeof v.mutationDurationMs === 'number' && v.mutationDurationMs >= 1000,
        usesSqliteOnlineBackup: onlineBackupEvidence,
      };
      const ok = Object.values(checks).every(Boolean);
      record(
        'C0-2',
        cmd,
        assertion,
        ok,
        JSON.stringify({ checks, raw: v, backupSourceFiles }, null, 2),
        ok ? undefined : `failing checks: ${Object.entries(checks).filter(([, v2]) => !v2).map(([k]) => k).join(', ')}`,
      );
    }
  }
}

// --- C0-3 ---
{
  const cmd = `pnpm exec tsx ${probeRestoreRel} --mode=corrupt --target=<db-page|project-file|manifest-entry>`;
  const assertion =
    'corrupting one archive entry (db page, project file, manifest entry) each independently makes the restore probe exit ' +
    'non-zero with detected:true; a clean archive (positive control, reused from C0-1) still restores successfully';
  if (!probeRestoreExists) {
    record('C0-3', cmd, assertion, false, '', `missing: ${probeRestoreRel}`);
  } else {
    const targets = ['db-page', 'project-file', 'manifest-entry'] as const;
    const perTarget = targets.map((target) => {
      const run = runRestoreProbe(['--mode=corrupt', `--target=${target}`, '--json']);
      const parsed = parseLastJsonLine(run.stdout);
      const detected = parsed.ok && isRecord(parsed.value) && parsed.value.detected === true;
      const ok = run.status !== 0 && detected;
      return { target, ok, status: run.status, stdout: run.stdout, error: parsed.ok ? undefined : parsed.error };
    });
    // Positive control: reuse C0-1's clean snapshot-restore run (exit 0) so a
    // probe that always exits non-zero regardless of corruption cannot pass.
    const controlOk = c01SnapshotRun !== null && c01SnapshotRun.status === 0;
    const ok = perTarget.every((t) => t.ok) && controlOk;
    record(
      'C0-3',
      cmd,
      assertion,
      ok,
      JSON.stringify({ perTarget, controlOk, controlRanAsC0_1: c01SnapshotRun !== null }, null, 2),
      ok
        ? undefined
        : `failing: ${[...perTarget.filter((t) => !t.ok).map((t) => t.target), ...(controlOk ? [] : ['clean-restore-control'])].join(', ')}`,
    );
  }
}

// =========================================================================
// C0-4 -- secret handling inventory (docs/security/backup-secret-inventory.json)
// =========================================================================

{
  const rel = 'docs/security/backup-secret-inventory.json';
  const cmd = `read ${rel}`;
  const assertion =
    'required-vs-optional data inventory covers every backup-scope class, with an explicit excluded/included-flagged ' +
    'policy per class; bulk classes required for restore must be included-flagged (an "exclude everything sensitive" ' +
    'inventory fails here because it would also exclude those); excluded classes must carry a documented-gap note';
  interface SecretClassEntry {
    class: string;
    required: boolean;
    sensitive: boolean;
    policy: 'excluded' | 'included-flagged';
    note?: string;
  }
  const EXPECTED_SENSITIVE: Record<string, boolean> = {
    'sqlite-database': false,
    'projects-dir': false,
    'library-assets': false,
    'memory-markdown': false,
    'app-config': false,
    'mcp-config-tokens': true,
    'connector-credentials': true,
    'byok-keys': true,
  };
  const MUST_BE_INCLUDED = ['sqlite-database', 'projects-dir', 'library-assets', 'memory-markdown', 'app-config'];
  const REQUIRED_CLASSES = Object.keys(EXPECTED_SENSITIVE);

  if (!fileExists(rel)) {
    record('C0-4', cmd, assertion, false, '', `missing: ${rel}; required classes: ${REQUIRED_CLASSES.join(', ')}`);
  } else {
    let entries: SecretClassEntry[] = [];
    let parseError: string | undefined;
    try {
      const raw = JSON.parse(readRepoFile(rel));
      if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
      entries = raw as SecretClassEntry[];
    } catch (err) {
      parseError = String(err);
    }
    if (parseError) {
      record('C0-4', cmd, assertion, false, '', `invalid JSON: ${parseError}`);
    } else {
      const byClass = new Map<string, SecretClassEntry[]>();
      for (const e of entries) {
        const list = byClass.get(e.class) ?? [];
        list.push(e);
        byClass.set(e.class, list);
      }
      const problems: string[] = [];
      for (const cls of REQUIRED_CLASSES) {
        const rows = byClass.get(cls) ?? [];
        if (rows.length !== 1) {
          problems.push(`class "${cls}": expected exactly 1 entry, found ${rows.length}`);
          continue;
        }
        const row = rows[0] as SecretClassEntry;
        if (row.sensitive !== EXPECTED_SENSITIVE[cls]) {
          problems.push(`class "${cls}": expected sensitive=${EXPECTED_SENSITIVE[cls]}, got ${row.sensitive}`);
        }
        if (row.policy !== 'excluded' && row.policy !== 'included-flagged') {
          problems.push(`class "${cls}": policy must be "excluded" or "included-flagged", got ${String(row.policy)}`);
        }
        if (MUST_BE_INCLUDED.includes(cls) && row.policy !== 'included-flagged') {
          problems.push(`class "${cls}": required-for-restore bulk data must be policy=included-flagged, got ${row.policy} (this is the "exclude everything" gaming vector)`);
        }
        if (row.policy === 'excluded' && (!row.note || row.note.trim().length < 10)) {
          problems.push(`class "${cls}": policy=excluded requires a documented-gap note (>=10 chars)`);
        }
      }
      const ok = problems.length === 0;
      record('C0-4', cmd, assertion, ok, JSON.stringify(entries, null, 2), ok ? undefined : problems.join('; '));
    }
  }
}

// =========================================================================
// C0-5 / C0-6 / C0-7 -- clipper capability tokens + privileged-route boundary
// Real daemon test suite, needle-matched by criterion tag embedded in test
// titles (same pattern as scripts/waves/verify-wc.ts's CC-2..CC-6).
// =========================================================================

{
  const cmd = `vitest (daemon suite) tests matching "(C0-5"`;
  const assertion =
    'red spec: arbitrary chrome-extension:// origin with no token is rejected; positive control: a valid identity-bound ' +
    'token is accepted -- both against the real HTTP route, not a mocked transport (R2)';
  const rejected = needleReport('(C0-5/reject)', 1);
  const accepted = needleReport('(C0-5/accept)', 1);
  const ok = rejected.ok && accepted.ok;
  record('C0-5', cmd, assertion, ok, `-- reject --\n${rejected.evidence}\n\n-- accept (control) --\n${accepted.evidence}`);
}

{
  const cmd = `vitest (daemon suite) tests matching "(C0-6"`;
  const assertion = 'tokens are non-transferable (cross-extension replay rejected), revocation is immediate, rotation invalidates the prior token';
  const replay = needleReport('(C0-6/replay)', 1);
  const revocation = needleReport('(C0-6/revocation)', 1);
  const rotation = needleReport('(C0-6/rotation)', 1);
  const ok = replay.ok && revocation.ok && rotation.ok;
  record(
    'C0-6',
    cmd,
    assertion,
    ok,
    `-- replay --\n${replay.evidence}\n\n-- revocation --\n${revocation.evidence}\n\n-- rotation --\n${rotation.evidence}`,
  );
}

{
  const rel = 'apps/daemon/src/security/privileged-routes.json';
  const cmd = `read ${rel}; vitest (daemon suite) tests matching "(C0-7"`;
  const assertion =
    'a frozen privileged-route inventory is committed first; the test suite carries one passing "(C0-7)"-tagged assertion ' +
    'per inventory row (count derived from the committed inventory, not hardcoded, so growing the inventory without growing ' +
    'coverage fails) plus a same-origin positive control that must succeed';
  if (!fileExists(rel)) {
    record('C0-7', cmd, assertion, false, '', `missing: ${rel} -- frozen privileged-route inventory`);
  } else {
    let routes: unknown[] = [];
    let parseError: string | undefined;
    try {
      const raw = JSON.parse(readRepoFile(rel));
      if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
      routes = raw;
    } catch (err) {
      parseError = String(err);
    }
    if (parseError) {
      record('C0-7', cmd, assertion, false, '', `invalid JSON: ${parseError}`);
    } else {
      const validRows = routes.filter((r) => isRecord(r) && typeof r.method === 'string' && typeof r.path === 'string');
      const rowCount = validRows.length;
      const iteration = needleReport('(C0-7/route)', Math.max(rowCount, 1));
      const control = needleReport('(C0-7/control)', 1);
      const ok = rowCount >= 1 && rowCount === routes.length && iteration.ok && control.ok;
      record(
        'C0-7',
        cmd,
        assertion,
        ok,
        `inventory rows: ${routes.length} (valid: ${rowCount})\n\n-- per-route origin-less rejection --\n${iteration.evidence}\n\n-- same-origin control --\n${control.evidence}`,
        ok ? undefined : `rowCount=${rowCount}, invalid rows=${routes.length - rowCount}, iterationOk=${iteration.ok}, controlOk=${control.ok}`,
      );
    }
  }
}

// =========================================================================
// C0-8 -- threat model document (docs/security/daemon-threat-model.md)
// =========================================================================

{
  const rel = 'docs/security/daemon-threat-model.md';
  const cmd = `read ${rel}`;
  const assertion =
    'documents all 6 named caller classes; every defense bullet cites a test ID (a C0-N criterion tag or a backtick-quoted ' +
    'file path); every cited file path must actually exist (R5 -- an unenforced defense claim is a lying-docs violation)';
  const CALLER_CLASSES = ['web UI', 'od CLI', 'clipper extension', 'external agent', 'malicious local process', 'malicious web page'];
  if (!fileExists(rel)) {
    record('C0-8', cmd, assertion, false, '', `missing: ${rel}`);
  } else {
    const text = readRepoFile(rel);
    const missingClasses = CALLER_CLASSES.filter((c) => !text.toLowerCase().includes(c.toLowerCase()));
    // A "defense bullet" is a top-level markdown list item under a heading
    // whose text mentions "defense" or "mitigat" -- avoids matching every
    // bullet in the document (e.g. caller-class descriptions).
    const sections = text.split(/^##\s+/m);
    const defenseSections = sections.filter((s) => /defense|mitigat/i.test(s.split('\n')[0] ?? ''));
    const defenseBullets = defenseSections.flatMap((s) => s.match(/^-\s.+$/gm) ?? []);
    const citationPattern = /`([\w./-]+\.test\.ts)`|\b(C0-\d{1,2})\b/;
    const uncited = defenseBullets.filter((b) => !citationPattern.test(b));
    const citedFiles = defenseBullets.flatMap((b) => [...b.matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1]));
    const missingCitedFiles = citedFiles.filter((f): f is string => typeof f === 'string' && !fileExists(f) && !fileExists(path.join('apps/daemon', f)));
    const ok = missingClasses.length === 0 && defenseBullets.length >= 5 && uncited.length === 0 && missingCitedFiles.length === 0;
    record(
      'C0-8',
      cmd,
      assertion,
      ok,
      `caller classes missing: ${missingClasses.join(', ') || 'none'}\ndefense bullets found: ${defenseBullets.length}\nuncited: ${uncited.length}\nmissing cited files: ${missingCitedFiles.join(', ') || 'none'}\n\n${defenseBullets.join('\n')}`,
      ok ? undefined : 'see evidence',
    );
  }
}

// =========================================================================
// C0-9 -- scale baseline (docs/testing/scale-baseline-2026-07.md), R8 protocol
// =========================================================================

{
  const rel = 'docs/testing/scale-baseline-2026-07.md';
  const cmd = `read ${rel}`;
  const assertion =
    'R8 protocol: fixed corpus (with a real MB/GB size), warmup policy, >=5 repetitions, p50 AND p95 reported, peak RSS ' +
    'reported, a stated minimum improvement threshold, and a version marker';
  if (!fileExists(rel)) {
    record('C0-9', cmd, assertion, false, '', `missing: ${rel}`);
  } else {
    const text = readRepoFile(rel);
    const repMatches = [...text.matchAll(/(\d+)\s*(?:reps?|repetitions?|runs?)\b/gi)].map((m) => Number(m[1]));
    const maxReps = repMatches.length > 0 ? Math.max(...repMatches) : 0;
    const checks = {
      corpusMentioned: /corpus/i.test(text),
      corpusHasSize: /corpus[\s\S]{0,200}?\b\d+(?:\.\d+)?\s*(?:MB|GB)\b/i.test(text) || /\b\d+(?:\.\d+)?\s*(?:MB|GB)\b[\s\S]{0,200}?corpus/i.test(text),
      warmupPolicy: /warm[- ]?up/i.test(text),
      atLeast5Reps: maxReps >= 5,
      p50Reported: /p50[^0-9]{0,20}[\d.]+/i.test(text),
      p95Reported: /p95[^0-9]{0,20}[\d.]+/i.test(text),
      peakRssReported: /peak[\s\S]{0,20}RSS[^0-9]{0,20}[\d.]+|RSS[^0-9]{0,20}[\d.]+[\s\S]{0,20}peak/i.test(text),
      minimumImprovementThreshold: /minimum improvement[^\n]{0,80}[\d.]+\s*%?/i.test(text),
      versioned: /version[:\s]+\S+/i.test(text),
    };
    const ok = Object.values(checks).every(Boolean);
    record('C0-9', cmd, assertion, ok, JSON.stringify(checks, null, 2), ok ? undefined : `failing: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`);
  }
}

// =========================================================================
// C0-10 / C0-11 -- UI/CLI parity capability manifest + harness
// =========================================================================

const capabilityManifestRel = 'scripts/waves/capability-manifest.json';
const probeParityRel = 'scripts/waves/probe-w0-parity.ts';

interface CapabilityManifestEntry {
  capability: string;
  uiEntryPoint: string;
  cliInvocation: string;
  httpMethod: string;
  httpPath: string;
  outputSchema: string;
  parityApplicable: boolean;
  reason?: string;
}

function runParityProbe(manifestPath: string, timeoutMs = 10 * 60_000): { status: number; stdout: string } {
  return sh('pnpm', ['exec', 'tsx', probeParityRel, '--manifest', manifestPath, '--json'], { timeoutMs });
}

// --- C0-10 ---
{
  const cmd = `pnpm exec tsx ${probeParityRel} --manifest ${capabilityManifestRel} --json`;
  const assertion =
    'capability manifest committed; harness invokes both UI and CLI surfaces per entry and asserts same handler + same ' +
    'contract shape; red control: a stub `od foo --json` printing `{}` next to an unrelated real GET route must FAIL';
  const manifestMissing = !fileExists(capabilityManifestRel);
  const probeMissing = !fileExists(probeParityRel);
  if (manifestMissing || probeMissing) {
    const missing = [manifestMissing && capabilityManifestRel, probeMissing && probeParityRel].filter(Boolean).join(', ');
    record('C0-10', cmd, assertion, false, '', `missing: ${missing}`);
  } else {
    let manifest: CapabilityManifestEntry[] = [];
    let parseError: string | undefined;
    try {
      const raw = JSON.parse(readRepoFile(capabilityManifestRel));
      if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
      manifest = raw as CapabilityManifestEntry[];
    } catch (err) {
      parseError = String(err);
    }
    if (parseError) {
      record('C0-10', cmd, assertion, false, '', `invalid manifest JSON: ${parseError}`);
    } else {
      const applicable = manifest.filter((e) => e.parityApplicable);
      // Positive run: the real committed manifest.
      const posRun = runParityProbe(path.join(repoRoot, capabilityManifestRel));
      const posParsed = parseLastJsonLine(posRun.stdout);
      const posResults = posParsed.ok && isRecord(posParsed.value) && Array.isArray(posParsed.value.results) ? (posParsed.value.results as { capability: string; status: string }[]) : [];
      const posAllPass = posParsed.ok && isRecord(posParsed.value) && posParsed.value.allPass === true;
      const posCountMatches = posResults.length === applicable.length;
      const posEveryPass = posResults.length > 0 && posResults.every((r) => r.status === 'pass');

      // Red control: inject a synthetic bad entry (stub CLI printing `{}`,
      // pointed at an unrelated real route) into a temp manifest the verifier
      // builds itself -- not trusted from the implementer's own tests.
      const stubPath = path.join(proofDir, 'w0-red-control-stub.mjs');
      fs.writeFileSync(stubPath, "#!/usr/bin/env node\nconsole.log('{}');\n");
      const badEntry: CapabilityManifestEntry = {
        capability: 'w0-verifier-red-control-foo',
        uiEntryPoint: 'n/a (verifier-injected red control)',
        cliInvocation: `node ${stubPath} --json`,
        httpMethod: 'GET',
        httpPath: '/api/health',
        outputSchema: 'n/a',
        parityApplicable: true,
        reason: 'synthetic mismatch injected by verify-w0.ts to prove the harness rejects a stub CLI beside an unrelated real route',
      };
      const redManifestPath = path.join(proofDir, 'w0-red-control-manifest.json');
      fs.writeFileSync(redManifestPath, JSON.stringify([...manifest, badEntry], null, 2));
      const redRun = runParityProbe(redManifestPath);
      const redParsed = parseLastJsonLine(redRun.stdout);
      const redResults = redParsed.ok && isRecord(redParsed.value) && Array.isArray(redParsed.value.results) ? (redParsed.value.results as { capability: string; status: string }[]) : [];
      const redEntry = redResults.find((r) => r.capability === 'w0-verifier-red-control-foo');
      const redControlCaughtIt = redEntry?.status === 'fail';

      const ok = posCountMatches && posAllPass && posEveryPass && redControlCaughtIt;
      record(
        'C0-10',
        cmd,
        assertion,
        ok,
        JSON.stringify({ manifestEntries: manifest.length, applicable: applicable.length, posResults, posAllPass, redResults, redControlCaughtIt }, null, 2),
        ok
          ? undefined
          : `posCountMatches=${posCountMatches}, posAllPass=${posAllPass}, posEveryPass=${posEveryPass}, redControlCaughtIt=${redControlCaughtIt}`,
      );
    }
  }
}

// --- C0-11 ---
{
  const probeFixtureRel = 'scripts/waves/probe-w0-guard-parity-fixture.ts';
  const cmd = `pnpm exec tsx ${probeFixtureRel} --json`;
  const assertion =
    'adding a capability to one surface only fails `pnpm guard` (proven with a temporary, self-reverting fixture); guard ' +
    'passes again once reverted, and the verifier confirms the working tree is left clean either way';
  if (!fileExists(probeFixtureRel)) {
    record('C0-11', cmd, assertion, false, '', `missing: ${probeFixtureRel}`);
  } else {
    const before = sh('git', ['status', '--porcelain']).stdout;
    const run = sh('pnpm', ['exec', 'tsx', probeFixtureRel, '--json'], { timeoutMs: 15 * 60_000 });
    const after = sh('git', ['status', '--porcelain']).stdout;
    const parsed = parseLastJsonLine(run.stdout);
    const treeCleanAfter = after.trim().length === 0;
    const checks = {
      probeExitedZero: run.status === 0,
      addedCapabilityBrokeGuard: parsed.ok && isRecord(parsed.value) && parsed.value.addedCapabilityBrokeGuard === true,
      revertedCleanly: parsed.ok && isRecord(parsed.value) && parsed.value.revertedCleanly === true,
      guardPassesAfterRevert: parsed.ok && isRecord(parsed.value) && parsed.value.guardPassesAfterRevert === true,
      treeCleanAfter,
    };
    const ok = Object.values(checks).every(Boolean);
    record(
      'C0-11',
      cmd,
      assertion,
      ok,
      JSON.stringify({ checks, before, after, raw: parsed.ok ? parsed.value : parsed.error }, null, 2),
      ok ? undefined : `failing: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`,
    );
  }
}

// =========================================================================
// C0-12 -- rebrand/stored-data compatibility inventory (inventory only)
// =========================================================================

{
  const rel = 'docs/security/stored-identity-inventory.md';
  const cmd = `read ${rel}`;
  const assertion =
    'every stored surface a rename would break is enumerated (.od/ paths, OD_* env vars, MCP server names, project JSON ' +
    'keys, connector credential records, sidecar stamps) with a record count per surface -- inventory only, no migration executed';
  const CATEGORIES = ['.od/', 'OD_', 'MCP server', 'project JSON key', 'connector credential', 'sidecar stamp'];
  if (!fileExists(rel)) {
    record('C0-12', cmd, assertion, false, '', `missing: ${rel}`);
  } else {
    const text = readRepoFile(rel);
    const missingCategories = CATEGORIES.filter((c) => !text.toLowerCase().includes(c.toLowerCase()));
    const tableRows = text.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:-]+\|/.test(l));
    const header = tableRows[0] ?? '';
    const hasCountColumn = /count/i.test(header);
    const dataRows = tableRows.slice(1);
    const ok = missingCategories.length === 0 && hasCountColumn && dataRows.length >= 6;
    record(
      'C0-12',
      cmd,
      assertion,
      ok,
      `categories missing: ${missingCategories.join(', ') || 'none'}\nhasCountColumn: ${hasCountColumn}\ndata rows: ${dataRows.length}\n\n${tableRows.join('\n')}`,
      ok ? undefined : 'see evidence',
    );
  }
}

// =========================================================================
// C0-13 -- current daemon failure inventory across a defined command matrix
// =========================================================================

{
  const rel = 'docs/testing/daemon-failure-inventory.md';
  const cmd = `read ${rel}; cross-checked against the real daemon suite run above`;
  const assertion =
    'a defined command matrix (unit, integration, e2e each named) reports current failures against current main -- "none" ' +
    'is only legitimate if the doc\'s claimed unit/integration failure count matches this run\'s actual failure count, and ' +
    'the e2e layer is not silently excluded';
  if (!fileExists(rel)) {
    record('C0-13', cmd, assertion, false, '', `missing: ${rel}`);
  } else {
    const text = readRepoFile(rel);
    const hasUnitSection = /unit/i.test(text);
    const hasIntegrationSection = /integration/i.test(text);
    const hasE2eSection = /e2e|end-to-end/i.test(text);
    const e2ePackageJson = fs.existsSync(path.join(repoRoot, 'e2e/package.json'))
      ? (JSON.parse(readRepoFile('e2e/package.json')) as { scripts?: Record<string, string> })
      : { scripts: {} };
    const e2eScriptNames = Object.keys(e2ePackageJson.scripts ?? {});
    const e2eReferencesRealCommand = e2eScriptNames.some((s) => text.includes(s)) || /pnpm --filter e2e/.test(text);
    const actualDaemonFailures = daemonSuite.data?.numFailedTests ?? null;
    const claimsNoneRegex = /unit[\s\S]{0,300}?\bnone\b/i;
    const docClaimsUnitNone = claimsNoneRegex.test(text);
    // If the doc claims "none" for unit failures, the real run this verifier
    // just performed must actually show zero failures -- otherwise "none" was
    // reached by not looking, which is exactly the named gaming vector.
    const unitClaimConsistent = actualDaemonFailures === null ? false : docClaimsUnitNone ? actualDaemonFailures === 0 : /\d+/.test(text);
    const ok = hasUnitSection && hasIntegrationSection && hasE2eSection && e2eReferencesRealCommand && unitClaimConsistent;
    record(
      'C0-13',
      cmd,
      assertion,
      ok,
      `unit section: ${hasUnitSection}, integration section: ${hasIntegrationSection}, e2e section: ${hasE2eSection}\ne2e references real command: ${e2eReferencesRealCommand} (known e2e scripts: ${e2eScriptNames.join(', ')})\nactual daemon suite failures (this run): ${actualDaemonFailures}\ndoc claims unit "none": ${docClaimsUnitNone}\nunitClaimConsistent: ${unitClaimConsistent}`,
      ok ? undefined : 'see evidence',
    );
  }
}

// =========================================================================
// C0-14 -- repo gates: guard, typecheck, daemon + web tests, no new skip/only/todo
// =========================================================================

{
  const cmd = 'pnpm guard && pnpm typecheck (+ daemon/web suites above, + diff-scoped skip/only/todo scan)';
  const assertion = 'pnpm guard exit 0; pnpm typecheck exit 0; daemon + web package tests green; zero skip/only/todo markers added by this wave\'s diff';
  const guard = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
  const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 20 * 60_000 });

  const changedFiles = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`])
    .stdout.trim()
    .split('\n')
    .filter(Boolean);
  const bannedMarker = /\b(?:it|describe|test)\.(?:skip|only|todo)\(/;
  const markerHits: string[] = [];
  for (const f of changedFiles) {
    if (!/\.test\.(ts|tsx|js|mjs|cjs)$/.test(f)) continue;
    const abs = path.join(repoRoot, f);
    if (!fs.existsSync(abs)) continue; // deleted in the diff
    if (bannedMarker.test(fs.readFileSync(abs, 'utf8'))) markerHits.push(f);
  }

  const checks = {
    guardExitZero: guard.status === 0,
    typecheckExitZero: typecheck.status === 0,
    daemonSuiteRanCleanly: daemonSuite.runResult.status === 0 && (daemonSuite.data?.numFailedTests ?? 1) === 0,
    webSuiteRanCleanly: webSuite.runResult.status === 0 && (webSuite.data?.numFailedTests ?? 1) === 0,
    noNewBannedMarkers: markerHits.length === 0,
  };
  const ok = Object.values(checks).every(Boolean);
  record(
    'C0-14',
    cmd,
    assertion,
    ok,
    `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n` +
      `daemon suite: exit=${daemonSuite.runResult.status} failed=${daemonSuite.data?.numFailedTests ?? 'unknown'} passed=${daemonSuite.data?.numPassedTests ?? 'unknown'}\n` +
      `web suite: exit=${webSuite.runResult.status} failed=${webSuite.data?.numFailedTests ?? 'unknown'} passed=${webSuite.data?.numPassedTests ?? 'unknown'}\n` +
      `new skip/only/todo markers in this wave's diff: ${markerHits.join(', ') || 'none'}\n` +
      `guard tail:\n${guard.stdout.slice(-4000)}\n\ntypecheck tail:\n${typecheck.stdout.slice(-4000)}`,
    ok ? undefined : `failing: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}`,
  );
}

// =========================================================================
// GATE-INTEGRITY -- the W0 lease grants write access to scripts/waves/**,
// which includes this very file, so the implementing agent could edit
// verify-w0.ts to always report pass. Record this file's sha256 so drift is
// visible, and hard-fail if an orchestrator-approved hash exists and no
// longer matches (absence of the approved-hash file is advisory only --
// nothing has been approved yet to drift from).
// =========================================================================

{
  const selfPath = fileURLToPath(import.meta.url);
  const selfSha256 = crypto.createHash('sha256').update(fs.readFileSync(selfPath)).digest('hex');
  const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w0-substrate', 'approved-gate.sha256');
  const gateIntegrityCmd = `sha256(${path.relative(repoRoot, selfPath)}) vs ${approvedHashPath}`;
  const gateIntegrityAssertion =
    'the gate script itself is not silently edited by the implementing agent (the W0 lease grants write access to scripts/waves/**, ' +
    'which includes verify-w0.ts); when an orchestrator-approved hash file exists, the current file must match it exactly';
  if (!fs.existsSync(approvedHashPath)) {
    record(
      'GATE-INTEGRITY',
      gateIntegrityCmd,
      gateIntegrityAssertion,
      true,
      `verify-w0.ts sha256: ${selfSha256}\nno approved-gate.sha256 present at ${approvedHashPath} -- advisory only until the orchestrator records an approved hash there`,
    );
  } else {
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record(
      'GATE-INTEGRITY',
      gateIntegrityCmd,
      gateIntegrityAssertion,
      gateOk,
      `verify-w0.ts sha256: ${selfSha256}\napproved sha256: ${approved}`,
      gateOk ? undefined : 'verify-w0.ts has been modified since the orchestrator approved it -- gate self-mutation detected',
    );
  }
}

// =========================================================================
// R9 -- write lease check (mechanical, read from docs/plans/waves/leases.json)
// =========================================================================

function globToRegExp(glob: string): RegExp {
  let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\*\*/g, ' GLOBSTAR ');
  re = re.replace(/\*/g, '[^/]*');
  re = re.replace(/ GLOBSTAR /g, '.*');
  return new RegExp(`^${re}$`);
}

{
  const leasesRaw = JSON.parse(readRepoFile('docs/plans/waves/leases.json')) as {
    waves: Record<string, { allow: string[]; deny?: string[] }>;
  };
  const w0Lease = leasesRaw.waves.W0;
  const diffCmd = `git diff --name-only ${baseCommit}...HEAD`;
  const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
  const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
  const branchHasCommits = baseCommit !== headSha;
  const warningPrefix = mainRefWarning ? `mainRef warning: ${mainRefWarning}\n\n` : '';

  if (!w0Lease) {
    record('LEASE', 'read docs/plans/waves/leases.json', 'W0 lease entry exists', false, '', 'no "W0" entry in leases.json');
  } else if (diffResult.status !== 0) {
    // An unevaluable diff must never be read as "no violations" -- that is
    // exactly how a broken command would silently pass the gate.
    record(
      'LEASE',
      diffCmd,
      'the diff command must succeed to evaluate the lease',
      false,
      `${warningPrefix}${diffResult.stdout}`,
      `git diff exited ${diffResult.status}`,
    );
  } else if (branchHasCommits && diffNames.length === 0) {
    // baseCommit != headSha but zero changed files is suspicious (empty
    // commits, a broken diff range, etc.) -- never treated as a pass.
    record(
      'LEASE',
      diffCmd,
      'a branch with commits ahead of baseCommit must show a non-empty diff',
      false,
      warningPrefix,
      `baseCommit=${baseCommit} headSha=${headSha} differ but git diff reported zero changed files`,
    );
  } else {
    const allowRe = w0Lease.allow.map(globToRegExp);
    const denyRe = (w0Lease.deny ?? []).map(globToRegExp);
    const violations = diffNames.filter((f) => {
      const allowed = allowRe.some((re) => re.test(f));
      const denied = denyRe.some((re) => re.test(f));
      return !allowed || denied;
    });
    record(
      'LEASE',
      `${diffCmd} ⊆ leases.json[W0].allow − .deny`,
      'no writes outside the W0 lease',
      violations.length === 0,
      `${warningPrefix}${violations.join('\n') || `all ${diffNames.length} changed files inside the lease:\n${diffNames.join('\n')}`}`,
    );
  }
}

// =========================================================================
// Commit-bound proof manifest
// =========================================================================

const statusResult = sh('git', ['status', '--porcelain']);
// A failed `git status` can never be silently read as "clean" -- fail safe.
const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;
const manifest = {
  wave: 'W0',
  commit: headSha,
  treeDirty,
  baseCommit,
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const failures = results.filter((r) => r.status === 'fail');
console.log(`\nverify-w0: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty})`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id} — ${r.assertion}${r.detail ? ` (${r.detail})` : ''}`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT §2)');
process.exit(failures.length === 0 && !treeDirty ? 0 : 1);
