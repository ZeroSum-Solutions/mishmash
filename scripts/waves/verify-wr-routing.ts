#!/usr/bin/env tsx
// verify-wr-routing.ts -- wave WR (model routing system) mechanical verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// governed by docs/plans/waves/WR-routing.md (see VERIFICATION-CONTRACT.md,
// which this wave reuses from the mishmash-completion program even though it
// belongs to a separate plan, docs/plans/2026-08-05-model-routing-system.md)
// and is deleted, with the rest of scripts/waves/, when that program closes.
//
// FIX ROUND 4 (2026-08-05): two PARTIALs after round 3 resolved every HIGH.
//   1. Frozen-section coverage extended to the identity-bearing preamble
//      (title through front matter, before the first "## " heading -- not
//      itself heading-delimited, so frozen as a byte range via
//      extractPreamble()) and to "## Scope" (the wave's authorized phases
//      and gates), both folded into CWR-P0-4's post-landing check.
//   2. Exact final operation order: (all criteria probes) -> HEAD-DRIFT's
//      fresh-main leg (ls-remote/fetch, no re-resolve) -> git status/dirty
//      check -> GATE-INTEGRITY phase 1 -> the FINAL HEAD+base re-resolve
//      (the only re-resolve in the run, the very last git reads, recorded
//      into the manifest as finalHead/finalBase with stability booleans) ->
//      GATE-INTEGRITY phase 2 self-hash -> single atomic manifest write. No
//      git operation of any kind follows the final re-resolve.
//
// FIX ROUND 3 (2026-08-05): Sol-directed remediation, four new blockers after
// round 2 resolved every prior HIGH.
//
//   1. Pre-landing scope lock: mode=pre-landing no longer only locks GATING
//      to P0 -- it now asserts the diff itself touches ONLY the three
//      governance files (this PRD, leases.json, this verifier). Any other
//      path in a pre-landing diff is an unconditional blocking failure
//      (PRE-LANDING-SCOPE). Without this, a pre-landing diff could carry
//      untested product code that never blocks anything and still merges.
//   2. Hardcoded criterion->tranche map: CRITERION_TRANCHE below is the
//      single source of truth for which criterion belongs to which tranche.
//      GATE-INTEGRITY cross-checks the PRD's Tranche register rows against
//      it and fails on divergence; the gating set is computed from this
//      CONSTANT plus the register's open/complete STATUS only -- never from
//      the register's own parsed criteria-per-row text. This closes the
//      exploit where editing the PRD table's "Owns criteria" column could
//      reassign which criteria gate.
//   3. Verifier self-freeze post-landing: once mode=post-landing, this file
//      itself must be byte-identical to its baseCommit version (folded into
//      CWR-P0-4) -- "verifier changes are governance changes." Exempted
//      pre-landing (the file is still being authored), which fix 1 makes
//      safe: a pre-landing diff can only touch governance files anyway.
//   4. FROZEN_SECTION_HEADINGS now also covers Tranche-entry gate, Verifier
//      contract, Enforcement boundaries, and Review protocol.
//
// Also this round: existsAtRef()/readAt() discriminate "path missing at a
// valid ref" (git says "fatal: path '...' does not exist in '<ref>'") from
// a real command failure (any other stderr), throwing on the latter instead
// of silently reading it as "missing" (M6 residue). HEAD-DRIFT's final,
// authoritative re-read now runs immediately before the manifest write
// (after GATE-INTEGRITY phase 1, before phase 2) in addition to the earlier
// post-probe check.
//
// FIX ROUND 2: replaced the round-1 GOVERNANCE_COMMIT two-commit pin with
// base-anchored governance (read from baseCommit, merge-base with
// origin/main) plus an explicit pre-landing mode for the current, actual
// state (no WR key at baseCommit yet) -- a verifier on an unlanded branch
// cannot fully self-attest via a pin stored in its own history.
//
// STATUS ENUM: exactly pass | fail | blocked-on-founder, matching
// VERIFICATION-CONTRACT.md §2. Any non-pass status on a gating criterion
// blocks exit 0, including blocked-on-founder.
//
// Run: pnpm exec tsx scripts/waves/verify-wr-routing.ts

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const WAVE_SLUG = 'wr-routing';
const proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
fs.mkdirSync(proofDir, { recursive: true });

const PRD_PATH = 'docs/plans/waves/WR-routing.md';
const LEASES_PATH = 'docs/plans/waves/leases.json';
const VERIFIER_PATH = 'scripts/waves/verify-wr-routing.ts';
// The ONLY paths a pre-landing diff may touch (fix-round-3, finding 1).
const GOVERNANCE_ONLY_FILES: readonly string[] = [PRD_PATH, LEASES_PATH, VERIFIER_PATH];

// ---------------------------------------------------------------- helpers --

function sh(cmd: string, args: string[], cwd: string = repoRoot, timeoutMs = 15 * 60_000): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// Hard-fail helper: any proof-bearing git command error is a verifier
// failure, never a swallowed empty string treated as "no change".
function gitOrFail(args: string[], timeoutMs?: number): string {
  const r = sh('git', args, repoRoot, timeoutMs);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 500)}`);
  return r.stdout.trim();
}

// Discriminates "the path doesn't exist at this ref" (expected, not an
// error) from a real git command failure (bad ref, corrupt repo, etc.),
// which must hard-fail instead of being silently read as "missing"
// (fix-round-3, finding 5 / M6 residue). Empirically verified against this
// git version: a missing path at a VALID ref says exactly
// "fatal: path '<path>' does not exist in '<ref>'" on stderr; an invalid
// ref itself says "fatal: invalid object name '<ref>'" -- that is a command
// failure, not a missing-path condition, since every ref this file passes
// (baseCommit, HEAD) is one it resolved itself and expects to be valid.
function classifyGitPathError(stderr: string): 'missing-path' | 'command-failure' {
  return /^fatal: path '.*' does not exist in /.test(stderr.trim()) ? 'missing-path' : 'command-failure';
}

function existsAtRef(ref: string, relPath: string): boolean {
  const r = sh('git', ['cat-file', '-e', `${ref}:${relPath}`]);
  if (r.status === 0) return true;
  if (classifyGitPathError(r.stderr) === 'missing-path') return false;
  throw new Error(`git cat-file -e ${ref}:${relPath} failed unexpectedly (exit ${r.status}): ${r.stderr.slice(0, 500)}`);
}

function readAt(commit: string, relPath: string): string | null {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status === 0) return r.stdout;
  if (classifyGitPathError(r.stderr) === 'missing-path') return null;
  throw new Error(`git show ${commit}:${relPath} failed unexpectedly (exit ${r.status}): ${r.stderr.slice(0, 500)}`);
}

function readText(relPath: string): string | null {
  const abs = path.join(repoRoot, relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
  }
}

interface WaveLeaseEntry {
  slug?: string;
  allow?: unknown;
  deny?: unknown;
  note?: string;
}
interface LeasesFile {
  waves?: Record<string, WaveLeaseEntry>;
}
interface PrdLease {
  slug?: string;
  allow?: unknown;
  deny?: unknown;
}
function parseLeasesText(text: string | null): LeasesFile | null {
  try {
    return text ? (JSON.parse(text) as LeasesFile) : null;
  } catch {
    return null;
  }
}

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: 'pass' | 'fail' | 'blocked-on-founder';
  detail?: string | undefined;
}

function artifactFor(id: string, content: string): { artifact: string; artifactSha256: string } {
  const file = path.join(proofDir, `${id}.txt`);
  fs.writeFileSync(file, content);
  return { artifact: file, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
}

const results: CriterionResult[] = [];
function record(id: string, command: string, assertion: string, status: 'pass' | 'fail' | 'blocked-on-founder', evidence: string, detail?: string): void {
  const { artifact, artifactSha256 } = artifactFor(id, `# ${id}\n# assertion: ${assertion}\n# verdict: ${status}\n\n${evidence}\n`);
  results.push({ id, command, assertion, artifact, artifactSha256, exitCode: status === 'pass' ? 0 : 1, status, detail });
}

// Wraps a criterion's computation so an unexpected exception (including a
// hard git failure inside the criterion body) becomes an honest 'fail'
// entry instead of aborting the whole run past this one check.
function safely(id: string, command: string, assertion: string, fn: () => { status: 'pass' | 'fail' | 'blocked-on-founder'; evidence: string; detail?: string }): void {
  try {
    const r = fn();
    record(id, command, assertion, r.status, r.evidence, r.detail);
  } catch (error) {
    record(id, command, assertion, 'fail', `unhandled error: ${String((error as Error)?.stack ?? error)}`);
  }
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if (c === '?') {
      pattern += '[^/]';
    } else {
      pattern += '\\^$+?.()|{}[]'.includes(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`${pattern}$`);
}
function matchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(filePath));
}
function isLiteralGlob(glob: string): boolean {
  return !/[*?]/.test(glob);
}
// Real glob-intersection: two globs can share a path when one's literal
// prefix (everything before its first */?) is a prefix of the other's --
// the conservative structural check the finding asked for. DELIBERATELY
// CONSERVATIVE (over-inclusive) by design: a false positive costs a line of
// documentation, a false negative costs a silent write conflict.
function globPrefix(glob: string): string {
  const idx = glob.search(/[*?]/);
  return idx === -1 ? glob : glob.slice(0, idx);
}
function globsIntersect(a: string, b: string): boolean {
  const pa = globPrefix(a);
  const pb = globPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// Extracts a top-level "## Heading" section (through the next "## " line or
// EOF) verbatim, including the heading line itself, for byte-identity
// comparison against baseCommit's version.
function extractSection(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

// Extracts the identity-bearing preamble -- everything from the file's
// first byte through the line immediately before the first "## " heading
// (title, Slug/Gates-on/Parallel-with/Loop/Program/Review-status front
// matter). Not heading-delimited on its own, so it is frozen as this byte
// range rather than via extractSection() (fix-round-4, finding 1).
function extractPreamble(text: string): string {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^## /.test(l));
  return (idx === -1 ? lines : lines.slice(0, idx)).join('\n');
}

// Real, mechanical byte-preservation proof: every removed/changed line in
// `git diff --unified=0 fromRef..toRef -- filePath` is a violation, except
// lines matching ignorePattern. Hard-fails on a git error instead of
// silently reading an empty diff as "no changes".
function diffRemovals(fromRef: string, toRef: string, filePath: string, ignorePattern?: RegExp): string[] {
  const diff = gitOrFail(['diff', '--unified=0', `${fromRef}..${toRef}`, '--', filePath]);
  const removals: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('@@')) continue;
    if (line.startsWith('-')) {
      const content = line.slice(1);
      if (ignorePattern && ignorePattern.test(content)) continue;
      removals.push(line);
    }
  }
  return removals;
}

// Mirror of diffRemovals for the '+' side. Used only by BYTE-PRESERVE, to
// confirm that a sanctioned line change installed the replacement the
// amendment actually authorised rather than an arbitrary one.
function diffAdditions(fromRef: string, toRef: string, filePath: string): string[] {
  const diff = gitOrFail(['diff', '--unified=0', `${fromRef}..${toRef}`, '--', filePath]);
  const additions: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) additions.push(line.slice(1));
  }
  return additions;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]) && new Set(a).size === a.length;
}

// -------------------------------------------------- canonical lease/state --

const CANONICAL_ALLOW: readonly string[] = [
  'docs/plans/waves/WR-routing.md',
  'docs/plans/waves/leases.json',
  'scripts/waves/verify-wr-routing.ts',
  'apps/daemon/src/routing/**',
  'apps/daemon/src/routes/routing.ts',
  'apps/daemon/tests/routing*.test.ts',
  'apps/daemon/tests/routing/**',
  'packages/contracts/src/api/routing-policy.ts',
  'packages/contracts/src/api/routing-decision.ts',
  'packages/contracts/src/api/routing-telemetry.ts',
  'packages/contracts/tests/routing*.test.ts',
  'apps/web/src/components/routing/**',
  'apps/daemon/src/cli.ts',
  'apps/daemon/src/server.ts',
  'scripts/waves/capability-manifest.json',
  'scripts/guard.ts',
  'packages/contracts/src/index.ts',
  'apps/web/src/components/AssistantMessage.tsx',
  // Amendment 1 (2026-08-06, founder-gated): seven additive-only grants.
  'apps/daemon/src/backup/create.ts',
  'packages/contracts/src/api/chat.ts',
  'packages/contracts/src/errors.ts',
  'apps/web/src/components/SettingsDialog.tsx',
  'docs/plans/waves/DECISIONS.md',
  'apps/web/tests/settings-dialog-routing.test.tsx',
  'apps/daemon/src/app-config.ts',
  // Amendment 2 (2026-08-07, founder-granted): two additive grants, plus the
  // five verbatim line exceptions in BYTE_PRESERVE_EXCEPTIONS above (which
  // apply to already-granted files and add no new paths).
  'packages/contracts/src/api/app-config.ts',
  'apps/daemon/src/http/response.ts',
];
const CANONICAL_DENY: readonly string[] = [
  'apps/web/src/providers/registry.ts',
  'packages/contracts/src/api/model-routing.ts',
  'docs/plans/waves/W6a-client-website.md',
  'docs/plans/2026-08-03-client-website-studio-prd.md',
  'scripts/waves/verify-w6a-*.ts',
];

interface Overlap {
  file: string;
  pattern: string;
  wave: string;
}
const EXPECTED_OVERLAPS: readonly Overlap[] = [
  // A -- exact-file overlaps
  { file: 'apps/daemon/src/cli.ts', pattern: 'apps/daemon/src/cli.ts', wave: 'W0' },
  { file: 'apps/daemon/src/cli.ts', pattern: 'apps/daemon/src/cli.ts', wave: 'W1' },
  { file: 'apps/daemon/src/cli.ts', pattern: 'apps/daemon/src/cli.ts', wave: 'W3' },
  { file: 'apps/daemon/src/cli.ts', pattern: 'apps/daemon/src/cli.ts', wave: 'W4' },
  { file: 'apps/daemon/src/server.ts', pattern: 'apps/daemon/src/server.ts', wave: 'W1' },
  { file: 'apps/daemon/src/server.ts', pattern: 'apps/daemon/src/server.ts', wave: 'W4' },
  { file: 'scripts/waves/capability-manifest.json', pattern: 'scripts/waves/capability-manifest.json', wave: 'W1' },
  { file: 'scripts/waves/capability-manifest.json', pattern: 'scripts/waves/capability-manifest.json', wave: 'W4' },
  { file: 'scripts/guard.ts', pattern: 'scripts/guard.ts', wave: 'W0' },
  { file: 'scripts/guard.ts', pattern: 'scripts/guard.ts', wave: 'W2' },
  { file: 'apps/web/src/components/AssistantMessage.tsx', pattern: 'apps/web/src/components/AssistantMessage.tsx', wave: 'W1' },
  // B -- structural glob overlaps
  { file: 'docs/plans/waves/WR-routing.md', pattern: 'docs/plans/waves/**', wave: 'W-C' },
  { file: 'docs/plans/waves/WR-routing.md', pattern: 'docs/plans/waves/**', wave: 'W0' },
  { file: 'docs/plans/waves/WR-routing.md', pattern: 'docs/plans/waves/**', wave: 'W7' },
  { file: 'docs/plans/waves/leases.json', pattern: 'docs/plans/waves/**', wave: 'W-C' },
  { file: 'docs/plans/waves/leases.json', pattern: 'docs/plans/waves/**', wave: 'W0' },
  { file: 'docs/plans/waves/leases.json', pattern: 'docs/plans/waves/**', wave: 'W7' },
  { file: 'scripts/waves/verify-wr-routing.ts', pattern: 'scripts/waves/**', wave: 'W0' },
  { file: 'scripts/waves/capability-manifest.json', pattern: 'scripts/waves/**', wave: 'W0' },
  { file: 'packages/contracts/src/api/routing-policy.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/api/routing-policy.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'packages/contracts/src/api/routing-decision.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/api/routing-decision.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'packages/contracts/src/api/routing-telemetry.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/api/routing-telemetry.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'packages/contracts/tests/routing*.test.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/tests/routing*.test.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'packages/contracts/src/index.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/index.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'apps/daemon/tests/routing*.test.ts', pattern: 'apps/daemon/tests/**', wave: 'W0' },
  { file: 'apps/daemon/tests/routing*.test.ts', pattern: 'apps/daemon/tests/**', wave: 'W1' },
  { file: 'apps/daemon/tests/routing*.test.ts', pattern: 'apps/daemon/tests/**', wave: 'W3' },
  { file: 'apps/daemon/tests/routing*.test.ts', pattern: 'apps/daemon/tests/**', wave: 'W4' },
  { file: 'apps/daemon/tests/routing/**', pattern: 'apps/daemon/tests/**', wave: 'W0' },
  { file: 'apps/daemon/tests/routing/**', pattern: 'apps/daemon/tests/**', wave: 'W1' },
  { file: 'apps/daemon/tests/routing/**', pattern: 'apps/daemon/tests/**', wave: 'W3' },
  { file: 'apps/daemon/tests/routing/**', pattern: 'apps/daemon/tests/**', wave: 'W4' },
  // Amendment 1 (2026-08-06) -- overlaps for the seven new grants; only the
  // five below have rows -- SettingsDialog.tsx and app-config.ts intersect
  // no other wave's lease, so they have none.
  { file: 'apps/daemon/src/backup/create.ts', pattern: 'apps/daemon/src/backup/**', wave: 'W0' },
  { file: 'apps/daemon/src/backup/create.ts', pattern: 'apps/daemon/src/backup/create.ts', wave: 'W4' },
  { file: 'packages/contracts/src/api/chat.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/api/chat.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'packages/contracts/src/errors.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/errors.ts', pattern: 'packages/contracts/**', wave: 'W4' },
  { file: 'docs/plans/waves/DECISIONS.md', pattern: 'docs/plans/waves/**', wave: 'W-C' },
  { file: 'docs/plans/waves/DECISIONS.md', pattern: 'docs/plans/waves/**', wave: 'W0' },
  { file: 'docs/plans/waves/DECISIONS.md', pattern: 'docs/plans/waves/**', wave: 'W7' },
  { file: 'docs/plans/waves/DECISIONS.md', pattern: 'docs/plans/waves/DECISIONS.md', wave: 'W9-ingest' },
  { file: 'apps/web/tests/settings-dialog-routing.test.tsx', pattern: 'apps/web/tests/**', wave: 'W1' },
  { file: 'apps/web/tests/settings-dialog-routing.test.tsx', pattern: 'apps/web/tests/**', wave: 'W3' },
  { file: 'apps/web/tests/settings-dialog-routing.test.tsx', pattern: 'apps/web/tests/**', wave: 'W4' },
  // Amendment 2 (2026-08-07) -- the contracts app-config DTO falls inside W1's
  // and W4's packages/contracts/** the same way chat.ts and errors.ts do.
  // apps/daemon/src/http/response.ts intersects no other wave's lease (checked
  // by glob against every non-WR entry), so it has no row.
  { file: 'packages/contracts/src/api/app-config.ts', pattern: 'packages/contracts/**', wave: 'W1' },
  { file: 'packages/contracts/src/api/app-config.ts', pattern: 'packages/contracts/**', wave: 'W4' },
];

const OVERLAP_FILES: readonly string[] = [
  'apps/daemon/src/cli.ts',
  'apps/daemon/src/server.ts',
  'scripts/waves/capability-manifest.json',
  'scripts/guard.ts',
  'packages/contracts/src/index.ts',
  'apps/web/src/components/AssistantMessage.tsx',
  // Amendment 1 (2026-08-06): every new grant that existed at baseCommit is
  // byte-preserved, so "additive only" is mechanical, not prose. DECISIONS.md
  // inclusion makes the amendment trail append-only by the same check. The
  // settings-dialog-routing test file is new (absent at baseCommit) and is
  // therefore additive by construction.
  'apps/daemon/src/backup/create.ts',
  'packages/contracts/src/api/chat.ts',
  'packages/contracts/src/errors.ts',
  'apps/web/src/components/SettingsDialog.tsx',
  'docs/plans/waves/DECISIONS.md',
  // Sol round-2 P1: the archived routingPolicyVersion key must survive
  // filterAllowedKeys, so the allowlist file itself is granted additively.
  // Like SettingsDialog.tsx it intersects no other wave's lease.
  'apps/daemon/src/app-config.ts',
  // Amendment 2 (2026-08-07): both new grants are byte-preserved on the same
  // terms. The contracts app-config DTO is additive (a field + a derived
  // request type); the status map gains one row.
  'packages/contracts/src/api/app-config.ts',
  'apps/daemon/src/http/response.ts',
];

// Amendment 2 (2026-08-07, founder-granted): the ONLY pre-existing lines this
// wave may change, declared VERBATIM so that the lease's "one-line exception
// process" is a machine-checked artifact instead of prose in a PR body.
//
// BYTE-PRESERVE still fails on every other removed or changed line in these
// files. That is the entire reason the exception is enumerated rather than the
// criterion being allowed to go red: a blanket red says "something in here
// changed" and stops distinguishing the five sanctioned edits from a sixth
// unsanctioned one, throwing away the guarantee exactly where the wave is
// carving into it.
//
// Each entry pins BOTH sides: `from` is the verbatim pre-amendment line, `to`
// is the replacement the grant actually authorises. Recording only `from`
// would let any replacement through -- swapping the second `'FORBIDDEN'` for
// `'INTERNAL_ERROR'` rather than `'ROUTING_BLOCKED'` would still have produced
// a green BYTE-PRESERVE, so a P0 criterion would be reporting that an
// unauthorised change was authorised (GPT-5.6 Sol adversarial review, P1).
// A removal is sanctioned only when its `to` line is genuinely present among
// that file's ADDED lines.
//
// Each entry is consumed at most once per file, so declaring a line does not
// license removing several copies of it. A `from` that matches more than one
// line at baseCommit is rejected outright by the self-check below, because
// content-addressed exceptions cannot say WHICH copy they meant.
//
// These entries go inert the moment the amendment lands: baseCommit then
// carries the `to` lines, so the `from` content is no longer present to be
// removed and no later diff can match them.
interface LineException {
  readonly from: string;
  readonly to: string;
}
const BYTE_PRESERVE_EXCEPTIONS: Readonly<Record<string, readonly LineException[]>> = {
  // Item 1 -- emit the dedicated 'ROUTING_BLOCKED' code Amendment 1 declared,
  // instead of the interim 'FORBIDDEN' (an authorization refusal) for what is
  // actually a policy refusal.
  'apps/daemon/src/server.ts': [
    {
      from: "        return design.runs.fail(run, 'FORBIDDEN', wrDispatchRouting.blocked.message, {",
      to: "        return design.runs.fail(run, 'ROUTING_BLOCKED', wrDispatchRouting.blocked.message, {",
    },
    { from: "            'FORBIDDEN',", to: "            'ROUTING_BLOCKED'," },
  ],
  // Item 4 -- an unparseable app-config must not be archived as a bare `{}`
  // with the exception swallowed. Needs the error binding and the return.
  'apps/daemon/src/backup/create.ts': [
    { from: '  } catch {', to: '  } catch (error) {' },
    { from: '    return JSON.stringify({});', to: '    return JSON.stringify(' },
  ],
  // Item 3 -- the update DTO was DERIVED from the full prefs shape, so adding
  // `routingPolicyVersion` to `AppConfigPrefs` would have silently declared a
  // server-owned key writable. Narrowing the derivation is the fix, and a
  // derived type alias cannot be narrowed by adding a line beside it.
  'packages/contracts/src/api/app-config.ts': [
    {
      from: 'export type UpdateAppConfigRequest = Partial<AppConfigPrefs>;',
      to: 'export type UpdateAppConfigRequest = Partial<Omit<AppConfigPrefs, ServerOwnedAppConfigKey>>;',
    },
  ],
};

// fix-round-3, finding 4: extended to cover every remaining normative
// prose section, not just the data-shaped ones. fix-round-4, finding 1:
// '## Scope' added -- the wave's authorized phases and gates must not be
// widenable post-landing. The identity-bearing preamble (title through
// front matter, before this list's first heading) is not heading-delimited
// and is frozen separately via extractPreamble(), not through this array.
const FROZEN_SECTION_HEADINGS: readonly string[] = [
  '## Scope',
  '## Tranche-entry gate for P1/P2',
  '## Routing-key fallback (normative)',
  '## Screenshot-baseline rules (normative)',
  '## Verifier contract',
  '## Enforcement boundaries',
  '## Lease',
  '## Review protocol',
  '## Explicitly out of scope',
  '## Success criteria',
];

// Canonical criterion -> tranche ownership (fix-round-3, finding 2). The
// SOLE source of truth for gating: GATE-INTEGRITY cross-checks the PRD's
// Tranche register rows against this map and fails on divergence; the
// gating set is derived from this map + the register's open/complete
// STATUS per tranche name -- never from the register's own parsed
// criteria-per-row text, closing the in-memory register-rewrite exploit.
// 'always-gating' items bypass the register/mode mechanism entirely; 'P0'
// items are tranche-scoped but P0 can never revert to open once complete,
// so in practice this group behaves as always-gating too. The PRD's P0 row
// documents 'P0' ids UNION 'always-gating' ids together (no separate
// "always-gating" table row exists) -- GATE-INTEGRITY's cross-check
// computes that same union when validating the P0 row.
type TrancheOwnership = 'P0' | 'P1' | 'P2' | 'always-gating';
const CRITERION_TRANCHE: Readonly<Record<string, TrancheOwnership>> = {
  'CWR-P0-1': 'P0',
  'CWR-P0-2': 'P0',
  'CWR-P0-3': 'P0',
  'CWR-P0-4': 'P0',
  LEASE: 'P0',
  'HEAD-DRIFT': 'P0',
  'BYTE-PRESERVE': 'P0',
  'LEASE-INTEGRITY': 'always-gating',
  'GATE-INTEGRITY': 'always-gating',
  'CWR-P2-5': 'always-gating',
  'PRE-LANDING-SCOPE': 'always-gating',
  'CWR-P1-1': 'P1',
  'CWR-P1-2': 'P1',
  'CWR-P1-3': 'P1',
  'CWR-P2-1': 'P2',
  'CWR-P2-2': 'P2',
  'CWR-P2-3': 'P2',
  'CWR-P2-4': 'P2',
};
const ALL_CRITERION_IDS = Object.keys(CRITERION_TRANCHE);
const ALWAYS_GATING_IDS = new Set(Object.entries(CRITERION_TRANCHE).filter(([, t]) => t === 'always-gating').map(([id]) => id));
function idsForTranche(tranche: 'P0' | 'P1' | 'P2'): string[] {
  const own = Object.entries(CRITERION_TRANCHE).filter(([, t]) => t === tranche).map(([id]) => id);
  return tranche === 'P0' ? [...own, ...ALWAYS_GATING_IDS] : own;
}

// ------------------------------------------------------- git state (start) --
// Resolved once, hard-fail on error. Re-checked by HEAD-DRIFT after all
// behavioral probes, and again -- authoritatively -- immediately before the
// manifest write (fix-round-3, finding 6).
let headSha: string;
let baseCommit: string;
let diffNames: string[];
let headLeasesJson: LeasesFile | null;
let baseLeasesJson: LeasesFile | null;
try {
  headSha = gitOrFail(['rev-parse', 'HEAD']);
  baseCommit = gitOrFail(['merge-base', 'origin/main', 'HEAD']);
  diffNames = gitOrFail(['diff', '--name-only', `${baseCommit}...HEAD`]).split('\n').filter(Boolean);
  headLeasesJson = parseLeasesText(readText(LEASES_PATH));
  baseLeasesJson = parseLeasesText(readAt(baseCommit, LEASES_PATH));
} catch (error) {
  console.error(`verify-wr-routing: FATAL git resolution error at start -- ${String(error)}`);
  process.exit(1);
}

// ============================================================
// Mode detection -- a WR key in leases.json at baseCommit means this wave's
// governance has landed to main.
// ============================================================
const headWavesRecord: Record<string, WaveLeaseEntry> = headLeasesJson?.waves ?? {};
const wrLease: WaveLeaseEntry | undefined = headWavesRecord.WR;
const allowStr: readonly string[] = wrLease && Array.isArray(wrLease.allow) ? (wrLease.allow as string[]) : CANONICAL_ALLOW;
const denyStr: readonly string[] = wrLease && Array.isArray(wrLease.deny) ? (wrLease.deny as string[]) : CANONICAL_DENY;

const baseWavesRecord: Record<string, WaveLeaseEntry> = baseLeasesJson?.waves ?? {};
const baseWrLease: WaveLeaseEntry | undefined = baseWavesRecord.WR;
const mode: 'pre-landing' | 'post-landing' = baseWrLease ? 'post-landing' : 'pre-landing';

// ============================================================
// CWR-P0-1 -- wave identity document is complete and structurally sound.
// ============================================================
const prdText = readText(PRD_PATH);
{
  const requiredMarkers: [string, RegExp][] = [
    ['identity header names the wave and slug', /^# Wave WR — Model routing system/m],
    ['slug line', /\*\*Slug:\*\* `wr-routing`/],
    ['fix round 3 review status recorded', /fix-round-3/],
    ['root cause recorded (self-attestation)', /a verifier on an unlanded branch cannot fully\s*self-attest/],
    ['P0 phase section', /^### P0 — Governance \+ closure scaffold \(this tranche\)$/m],
    ['P1 phase section', /^### P1 — Policy \+ telemetry \(advisory\)$/m],
    ['P2 phase section', /^### P2 — Dispatch routing \+ admission control \+ deterministic gates$/m],
    ['explicit out-of-scope heading', /^## Explicitly out of scope$/m],
    ['P2.5 named as out of scope', /P2\.5 and P6 of the 2026-08-05 plan are out of this wave's scope/],
    ['P6 named as conditional/out of scope', /P6 \(conditional learned routing/],
    ['W3->W5->W6a non-bypass statement', /This wave does not bypass W3→W5→W6a ordering/],
    ['W6a deny glob named', /scripts\/waves\/verify-w6a-\*\.ts/],
    ['tranche-entry gate section', /^## Tranche-entry gate for P1\/P2$/m],
    ['fresh-main ancestry rule', /Fresh-main ancestry\./],
    ['byte-preservation rule', /Byte-preservation on every overlap file\./],
    ['W6a untouched rule', /W6a untouched\./],
    ['P0-must-land-first rule', /P0 \(governance\) must have landed to `main` first/],
    ['pre-landing diff scope rule (fix-round-3, finding 1)', /pre-landing diffs are governance-only/],
    ['tranche register section', /^## Tranche register$/m],
    ['tranche register grading rule (HIGH-3)', /Grading rule \(fix-round-1, HIGH-3, replacing the removed `skip` status\)/],
    ['always-gating exceptions named', /are the sole exceptions: they are unconditionally exit-blocking/],
    ['hardcoded criterion-tranche map described (fix-round-3, finding 2)', /CRITERION_TRANCHE/],
    ['routing-key fallback section (normative)', /^## Routing-key fallback \(normative\)$/m],
    ['routing-key nullable component (MED-9)', /key = \(templateId \| NONE\) × \(buildClass \| NONE\) × stage/],
    ['routing-key fallback B: general chat', /General chat \(no brief, no template\)/],
    ['routing-key fallback C: ingestion', /Ingestion \(plan §4 rights-laned pipeline\)/],
    ['routing-key fallback C: mobile', /Mobile \(plan §1 Lane C\)/],
    ['screenshot-baseline rules section (normative)', /^## Screenshot-baseline rules \(normative\)$/m],
    ['screenshot-baseline bootstrap step (MED-10)', /Bootstrap \(no SSIM gate yet\)\./],
    ['screenshot-baseline negative-control calibration step', /Negative-control calibration\./],
    ['screenshot-baseline promotion to baseline v1', /the render become \*\*baseline v1\*\*/],
    ['verifier contract section', /^## Verifier contract$/m],
    ['base-anchored governance subsection', /^### Base-anchored governance, with an explicit pre-landing mode/m],
    ['mode detection described', /\*\*Mode detection\.\*\*/],
    ['pre-landing mode described', /\*\*`mode: "pre-landing"`\*\*/],
    ['verifier self-freeze described (fix-round-3, finding 3)', /verifier changes are governance changes/],
    ['fresh-main fail-closed subsection', /^### Fresh-main, fail-closed/m],
    ['byte-preservation unconditional subsection', /^### Byte-preservation, unconditional/m],
    ['lease-collision corrected deny-precedence subsection', /^### Real lease-collision detection, with corrected deny-precedence/m],
    ['behavioral probes subsection', /^### Behavioral probes, not shape checks/m],
    ['gate-integrity two-phase subsection', /^### GATE-INTEGRITY runs last, as a two-phase write/m],
    ['enforcement boundaries section', /^## Enforcement boundaries$/m],
    ['lease section', /^## Lease$/m],
    ['review protocol section', /^## Review protocol$/m],
    ['review protocol names GPT-5.6 Sol', /GPT-5\.6 Sol \(Codex OAuth\)/],
    ['review protocol states reviewer != author', /Reviewer ≠ author always/],
    ['review protocol names Claude Max OAuth only', /Claude models are dispatched through Claude Code OAuth \(Max\) only/],
    ['review protocol quotes PRD §15 constraint', /No Anthropic model may use API credits, Nous, or OpenRouter for this program/],
    ['success criteria table', /^## Success criteria$/m],
    ['adversarial review section', /^## Adversarial review$/m],
  ];
  const flat = (prdText ?? '').replace(/\s+/g, ' ');
  const missing = requiredMarkers
    .filter(([, re]) => {
      if (!prdText) return true;
      const isHeading = re.source.startsWith('^');
      return !re.test(isHeading ? prdText : flat);
    })
    .map(([label]) => label);
  record(
    'CWR-P0-1',
    `read ${PRD_PATH}`,
    'wave identity document exists with every required section',
    prdText !== null && missing.length === 0 ? 'pass' : 'fail',
    prdText === null ? `${PRD_PATH} does not exist` : missing.length === 0 ? `all ${requiredMarkers.length} required markers present` : `missing markers:\n${missing.join('\n')}`,
  );
}

// ============================================================
// CWR-P0-2 -- lease matches the PRD's own declared JSON block, and both
// match the canonical lists defined in this file. Mode-independent.
// ============================================================
{
  const problems: string[] = [];
  if (!headLeasesJson) problems.push(`${LEASES_PATH} missing or invalid JSON`);
  if (!wrLease) problems.push('leases.json waves.WR entry missing');
  if (wrLease) {
    if (wrLease.slug !== 'wr-routing') problems.push(`leases.json WR.slug = ${String(wrLease.slug)}, expected "wr-routing"`);
    const allow = Array.isArray(wrLease.allow) && wrLease.allow.every((x) => typeof x === 'string') ? (wrLease.allow as string[]) : null;
    const deny = Array.isArray(wrLease.deny) && wrLease.deny.every((x) => typeof x === 'string') ? (wrLease.deny as string[]) : null;
    if (!allow) problems.push('leases.json WR.allow is not a string array');
    else if (!sameSet(allow, CANONICAL_ALLOW)) problems.push(`leases.json WR.allow does not match canonical allow list:\nactual=${JSON.stringify(allow)}\nexpected=${JSON.stringify(CANONICAL_ALLOW)}`);
    if (!deny) problems.push('leases.json WR.deny is not a string array');
    else if (!sameSet(deny, CANONICAL_DENY)) problems.push(`leases.json WR.deny does not match canonical deny list:\nactual=${JSON.stringify(deny)}\nexpected=${JSON.stringify(CANONICAL_DENY)}`);
    if (typeof wrLease.note !== 'string' || wrLease.note.trim().length === 0) problems.push('leases.json WR.note missing or empty');
  }
  const fence = prdText?.match(/## Lease\n\n[\s\S]*?```json\n([\s\S]*?)\n```/);
  const parsedPrdLease: PrdLease | null = (() => {
    if (!fence?.[1]) return null;
    try {
      return JSON.parse(fence[1]) as PrdLease;
    } catch {
      return null;
    }
  })();
  if (!parsedPrdLease) problems.push(`${PRD_PATH} "## Lease" section does not contain a parseable \`\`\`json block`);
  else {
    if (parsedPrdLease.slug !== 'wr-routing') problems.push(`PRD lease block slug = ${String(parsedPrdLease.slug)}, expected "wr-routing"`);
    const allow = Array.isArray(parsedPrdLease.allow) ? (parsedPrdLease.allow as unknown[]) : [];
    const deny = Array.isArray(parsedPrdLease.deny) ? (parsedPrdLease.deny as unknown[]) : [];
    if (!sameSet(allow as string[], CANONICAL_ALLOW)) problems.push('PRD lease block allow does not match canonical allow list');
    if (!sameSet(deny as string[], CANONICAL_DENY)) problems.push('PRD lease block deny does not match canonical deny list');
  }
  record(
    'CWR-P0-2',
    `parse ${LEASES_PATH} + ${PRD_PATH} "## Lease" block`,
    "leases.json's WR entry and the PRD's declared lease block both deep-equal the canonical allow/deny lists",
    problems.length === 0 ? 'pass' : 'fail',
    problems.length === 0 ? 'leases.json WR entry and PRD lease block both match the canonical allow/deny lists exactly' : problems.join('\n'),
  );
}

// ============================================================
// CWR-P0-3 -- no undocumented lease collisions, via real glob-intersection
// with corrected deny-precedence. Other waves' leases read from baseCommit.
// ============================================================
safely(
  'CWR-P0-3',
  'globsIntersect() every WR.allow entry against every other wave allow entry in leases.json@baseCommit, corrected deny-precedence applied',
  'every surviving allow-glob intersection with another wave is one of the documented overlaps; both denied files are absent from allow and present in deny',
  () => {
    const problems: string[] = [];
    const otherWaves = Object.entries(baseWavesRecord).filter(([name]) => name !== 'WR');
    const found = new Map<string, Overlap>();
    for (const ourGlob of allowStr) {
      for (const [waveName, lease] of otherWaves) {
        const theirAllow = Array.isArray(lease.allow) ? (lease.allow as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const theirDeny = Array.isArray(lease.deny) ? (lease.deny as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        for (const theirGlob of theirAllow) {
          if (!globsIntersect(ourGlob, theirGlob)) continue;
          const deniedByOwner = isLiteralGlob(ourGlob) && theirDeny.some((d) => globToRegExp(d).test(ourGlob));
          if (deniedByOwner) continue;
          const key = `${ourGlob}||${theirGlob}||${waveName}`;
          found.set(key, { file: ourGlob, pattern: theirGlob, wave: waveName });
        }
      }
    }
    const foundList = [...found.values()];
    const expectedKeys = new Set(EXPECTED_OVERLAPS.map((o) => `${o.file}||${o.pattern}||${o.wave}`));
    const foundKeys = new Set(foundList.map((o) => `${o.file}||${o.pattern}||${o.wave}`));
    for (const o of foundList) {
      const key = `${o.file}||${o.pattern}||${o.wave}`;
      if (!expectedKeys.has(key)) problems.push(`undocumented collision: ${o.file} intersects ${o.wave}'s ${o.pattern}`);
    }
    for (const o of EXPECTED_OVERLAPS) {
      const key = `${o.file}||${o.pattern}||${o.wave}`;
      if (!foundKeys.has(key)) problems.push(`documented overlap no longer collides (stale EXPECTED_OVERLAPS entry): ${o.file} vs ${o.wave}'s ${o.pattern}`);
    }
    for (const denied of CANONICAL_DENY) {
      if (allowStr.includes(denied)) problems.push(`${denied} is denied but also present in WR.allow`);
      if (!denyStr.includes(denied)) problems.push(`${denied} missing from WR.deny`);
    }
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence:
        problems.length === 0
          ? `checked ${allowStr.length} allow entries against ${otherWaves.length} other wave leases@baseCommit=${baseCommit}; ${foundList.length} real intersections, all documented; denies verified: ${CANONICAL_DENY.join(', ')}`
          : problems.join('\n'),
    };
  },
);

// ============================================================
// CWR-P0-4 -- governance content is base-anchored and un-widened once
// landed; ALSO the verifier's own self-freeze (fix-round-3, finding 3):
// once post-landing, verify-wr-routing.ts itself must be byte-identical to
// its baseCommit version. Pre-landing exempts this (the file is still being
// authored), which fix 1 (PRE-LANDING-SCOPE) makes safe.
// ============================================================
safely(
  'CWR-P0-4',
  `mode=${mode}; git show <baseCommit>:{${LEASES_PATH},${PRD_PATH},${VERIFIER_PATH}}`,
  "in pre-landing mode, nothing to freeze against yet (pass, enforced instead by the landing PR's review); once post-landing, leases.json's WR entry, this document's frozen sections, and this verifier file are byte-identical to their baseCommit versions",
  () => {
    if (mode === 'pre-landing') {
      return {
        status: 'pass',
        evidence:
          `mode=pre-landing: no WR key exists in leases.json@baseCommit=${baseCommit} -- this wave's governance has not landed to main yet, so there is nothing to freeze against. ` +
          "This is the expected, stable state: pinning becomes enforceable the moment P0 lands. Until then the landing PR's own adversarial review is the enforcement surface for the governance content itself. " +
          "Per fix-round-3 finding 1 (PRE-LANDING-SCOPE), a pre-landing diff can only touch this document, leases.json, and this verifier -- so this pass carries no risk of a product tranche free-riding on it.",
      };
    }
    const problems: string[] = [];
    const pAllow = Array.isArray(baseWrLease!.allow) ? (baseWrLease!.allow as string[]) : [];
    const pDeny = Array.isArray(baseWrLease!.deny) ? (baseWrLease!.deny as string[]) : [];
    if (!sameSet(pAllow, allowStr)) problems.push('leases.json WR.allow at HEAD differs from its baseCommit version -- the lease was widened or narrowed after landing');
    if (!sameSet(pDeny, denyStr)) problems.push('leases.json WR.deny at HEAD differs from its baseCommit version');
    const basePrd = readAt(baseCommit, PRD_PATH);
    for (const heading of FROZEN_SECTION_HEADINGS) {
      const baseSection = basePrd ? extractSection(basePrd, heading) : null;
      const headSection = prdText ? extractSection(prdText, heading) : null;
      if (baseSection === null || headSection === null || baseSection !== headSection) {
        problems.push(`frozen section "${heading}" differs from its baseCommit version (or is missing at one end)`);
      }
    }
    // fix-round-4, finding 1: the identity-bearing preamble (title through
    // front matter, before the first "## " heading) is not itself a
    // heading, so it is frozen separately as a byte range from file start.
    const basePreamble = basePrd ? extractPreamble(basePrd) : null;
    const headPreamble = prdText ? extractPreamble(prdText) : null;
    if (basePreamble === null || headPreamble === null || basePreamble !== headPreamble) {
      problems.push('preamble (title through front matter, before the first "## " heading) differs from its baseCommit version');
    }
    const baseVerifierText = readAt(baseCommit, VERIFIER_PATH);
    const headVerifierText = readText(VERIFIER_PATH);
    if (baseVerifierText === null || headVerifierText === null || baseVerifierText !== headVerifierText) {
      problems.push('scripts/waves/verify-wr-routing.ts differs from its baseCommit version -- verifier changes are governance changes: land them via a governance-only diff reviewed as blocked-on-founder');
    }
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `mode=post-landing: governance content matches baseCommit=${baseCommit} exactly (frozen sections + WR lease entry + verifier self-freeze)` : problems.join('\n'),
    };
  },
);

// ============================================================
// LEASE-INTEGRITY -- every OTHER wave's lease entry is byte-identical
// between baseCommit and HEAD. Unconditionally gating.
// ============================================================
safely(
  'LEASE-INTEGRITY',
  'diff leases.json@baseCommit vs HEAD for every waves.* key except WR',
  "every non-WR entry in leases.json is byte-identical between baseCommit and HEAD -- this wave's diff never touches another wave's entry",
  () => {
    const problems: string[] = [];
    const baseNames = Object.keys(baseWavesRecord);
    const headNames = Object.keys(headWavesRecord);
    for (const name of baseNames) {
      if (name === 'WR') continue;
      if (!(name in headWavesRecord)) {
        problems.push(`${name}: present at baseCommit, missing at HEAD`);
        continue;
      }
      const baseJson = JSON.stringify(baseWavesRecord[name]);
      const headJson = JSON.stringify(headWavesRecord[name]);
      if (baseJson !== headJson) problems.push(`${name}: entry differs between baseCommit and HEAD`);
    }
    const newNames = headNames.filter((n) => n !== 'WR' && !baseNames.includes(n));
    if (newNames.length > 0) problems.push(`unexpected new non-WR wave key(s) introduced by this diff: ${newNames.join(', ')}`);
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `all ${baseNames.filter((n) => n !== 'WR').length} non-WR wave entries byte-identical between baseCommit=${baseCommit} and HEAD` : problems.join('\n'),
    };
  },
);

// ============================================================
// LEASE -- R9 mechanical diff-subset check, real glob matching.
// ============================================================
safely(
  'LEASE',
  `git diff --name-only ${baseCommit}...HEAD`,
  "git diff --name-only <base>...HEAD is a subset of WR's allow globs and touches none of WR's deny globs",
  () => {
    const outsideAllow = diffNames.filter((f) => !matchesAnyGlob(f, allowStr));
    const insideDeny = diffNames.filter((f) => matchesAnyGlob(f, denyStr));
    const problems = [...outsideAllow.map((f) => `outside allow: ${f}`), ...insideDeny.map((f) => `inside deny: ${f}`)];
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `all ${diffNames.length} changed files inside the lease:\n${diffNames.join('\n')}` : problems.join('\n'),
    };
  },
);

// ============================================================
// PRE-LANDING-SCOPE (fix-round-3, finding 1) -- while mode=pre-landing, the
// diff may ONLY touch the three governance files. Unconditionally gating.
// This is the root-cause fix: without it, a pre-landing diff could carry
// untested product code that never blocks anything and still merges.
// ============================================================
safely(
  'PRE-LANDING-SCOPE',
  `git diff --name-only ${baseCommit}...HEAD (checked against the governance-only allowlist while mode=pre-landing)`,
  'while mode=pre-landing, the diff touches ONLY the three governance files -- pre-landing diffs are governance-only; product tranches require P0 landed to main',
  () => {
    if (mode !== 'pre-landing') {
      return { status: 'pass', evidence: `mode=${mode}: this check only constrains pre-landing diffs; not applicable post-landing.` };
    }
    const outside = diffNames.filter((f) => !GOVERNANCE_ONLY_FILES.includes(f));
    return {
      status: outside.length === 0 ? 'pass' : 'fail',
      evidence:
        outside.length === 0
          ? `all ${diffNames.length} changed files are governance-only: ${diffNames.join(', ') || '(none)'}`
          : `RULE VIOLATION: pre-landing diffs are governance-only; product tranches require P0 landed to main. Non-governance file(s) present in a pre-landing diff: ${outside.join(', ')}`,
    };
  },
);

// ============================================================
// BYTE-PRESERVE -- overlap files are additive-only and never deleted since
// baseCommit.
// ============================================================
safely(
  'BYTE-PRESERVE',
  `git cat-file -e <ref>:<file>; git diff --unified=0 ${baseCommit}..HEAD -- <each overlap file>`,
  'every overlap file that existed at baseCommit still exists at HEAD (missing = unconditional fail) and has zero removed/changed lines since baseCommit, except the lines Amendment 2 declares verbatim in BYTE_PRESERVE_EXCEPTIONS',
  () => {
    const problems: string[] = [];
    let sanctionedCount = 0;
    for (const f of OVERLAP_FILES) {
      const existedAtBase = existsAtRef(baseCommit, f);
      if (!existedAtBase) continue;
      const existsAtHead = existsAtRef('HEAD', f);
      if (!existsAtHead) {
        problems.push(`${f}: existed at baseCommit=${baseCommit} but is MISSING at HEAD (deleted) -- unconditional fail`);
        continue;
      }
      const removals = diffRemovals(baseCommit, 'HEAD', f);
      const declared = Object.prototype.hasOwnProperty.call(BYTE_PRESERVE_EXCEPTIONS, f)
        ? BYTE_PRESERVE_EXCEPTIONS[f]!
        : [];
      // Self-check: a content-addressed exception cannot say WHICH copy of a
      // repeated line it meant, so an ambiguous `from` is refused rather than
      // silently licensing the wrong one.
      const baseLines = existedAtBase ? gitOrFail(['show', `${baseCommit}:${f}`]).split('\n') : [];
      for (const ex of declared) {
        const occurrences = baseLines.filter((l) => l === ex.from).length;
        if (occurrences !== 1) {
          problems.push(`${f}: exception \`from\` matches ${occurrences} line(s) at baseCommit, must match exactly 1 (ambiguous or stale): ${ex.from}`);
        }
      }
      const additions = diffAdditions(baseCommit, 'HEAD', f);
      // Each declared exception is consumed at most once, so a single granted
      // line cannot license removing several identical copies of itself.
      const unclaimed = [...declared];
      const unsanctioned = removals.filter((line) => {
        const at = unclaimed.findIndex((ex) => ex.from === line.slice(1));
        if (at === -1) return true;
        // The grant authorises a SPECIFIC replacement, not merely the deletion.
        if (!additions.includes(unclaimed[at]!.to)) return true;
        unclaimed.splice(at, 1);
        sanctionedCount += 1;
        return false;
      });
      if (unsanctioned.length > 0) problems.push(`${f}: ${unsanctioned.length} removed/changed line(s) NOT covered by an Amendment 2 exception (a declared \`from\` whose authorised \`to\` is absent from the diff counts as uncovered):\n${unsanctioned.slice(0, 5).join('\n')}`);
    }
    const sanctionedNote = sanctionedCount > 0 ? `; ${sanctionedCount} Amendment 2 sanctioned line change(s) accounted for` : '';
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `zero unsanctioned removed/changed lines and zero deletions across all ${OVERLAP_FILES.length} overlap files since baseCommit=${baseCommit}${sanctionedNote}` : problems.join('\n\n'),
    };
  },
);

// ============================================================
// Behavioral probes. Real test/CLI invocations, never filename/source-shape
// checks. They legitimately fail today because P1/P2 code does not exist
// yet -- see the Tranche register for why that does not block this run's
// exit code. Suite QUALITY is a review boundary, not a verifier boundary --
// see WR-routing.md "Enforcement boundaries".
// ============================================================
interface VitestProbeResult {
  exitStatus: number;
  totalTests: number;
  failedTests: number;
  passedFullNames: string[];
  rawStdout: string;
  ranAtAll: boolean;
}
interface VitestJsonReport {
  numFailedTests?: number;
  testResults?: { assertionResults: { fullName: string; status: string }[] }[];
}
function runVitestFilter(pkgFilter: string, filterArgs: string[], cacheKey: string): VitestProbeResult {
  const jsonOut = path.join(proofDir, `${cacheKey}-vitest.json`);
  const run = sh('pnpm', ['--filter', pkgFilter, 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${jsonOut}`, ...filterArgs]);
  const data: VitestJsonReport | null = (() => {
    try {
      return JSON.parse(fs.readFileSync(jsonOut, 'utf8')) as VitestJsonReport;
    } catch {
      return null;
    }
  })();
  const allTests = data ? (data.testResults ?? []).flatMap((t) => t.assertionResults) : [];
  return {
    exitStatus: run.status,
    totalTests: allTests.length,
    failedTests: allTests.filter((t) => t.status !== 'passed').length,
    passedFullNames: allTests.filter((t) => t.status === 'passed').map((t) => t.fullName),
    rawStdout: run.stdout.slice(0, 3000),
    ranAtAll: data !== null,
  };
}
function gradeVitestCriterion(id: string, probe: VitestProbeResult, keywordPattern: RegExp, assertion: string, command: string): void {
  const keywordHit = probe.passedFullNames.some((n) => keywordPattern.test(n));
  const ok = probe.exitStatus === 0 && probe.totalTests > 0 && probe.failedTests === 0 && keywordHit;
  record(
    id,
    command,
    assertion,
    ok ? 'pass' : 'fail',
    `exit=${probe.exitStatus} totalTests=${probe.totalTests} failed=${probe.failedTests} keywordHit(${keywordPattern})=${keywordHit} ranAtAll=${probe.ranAtAll}\n${probe.rawStdout}`,
  );
}

const contractsRoutingProbe = runVitestFilter('@open-design/contracts', ['routing'], 'contracts-routing');
gradeVitestCriterion(
  'CWR-P1-1',
  contractsRoutingProbe,
  /drift|unknown stage|constraint/i,
  'routing-policy.json exists and its drift-failing policy test (unknown stage / missing constraint / §15 violation) passes',
  'pnpm --filter @open-design/contracts exec vitest run routing',
);
gradeVitestCriterion(
  'CWR-P1-2',
  contractsRoutingProbe,
  /routed.*observed|observed.*routed/i,
  'every run logs a complete telemetry row including routed-vs-observed model',
  'pnpm --filter @open-design/contracts exec vitest run routing',
);

safely(
  'CWR-P1-3',
  'grep routingPolicyVersion apps/daemon/src/backup/create.ts; test -f packages/contracts/src/api/routing-telemetry.ts',
  'policy version + telemetry rows are in the backup set (app-config + sqlite-database archive classes, no new ArchiveClass needed)',
  () => {
    const createSrc = readText('apps/daemon/src/backup/create.ts') ?? '';
    const hasPolicyVersionKey = /routingPolicyVersion/.test(createSrc);
    const telemetryContractExists = readText('packages/contracts/src/api/routing-telemetry.ts') !== null;
    const ok = hasPolicyVersionKey && telemetryContractExists;
    return {
      status: ok ? 'pass' : 'fail',
      evidence: `apps/daemon/src/backup/create.ts references routingPolicyVersion=${hasPolicyVersionKey}; packages/contracts/src/api/routing-telemetry.ts exists=${telemetryContractExists}`,
    };
  },
);

const daemonRoutingProbe = runVitestFilter('@open-design/daemon', ['routing'], 'daemon-routing');
gradeVitestCriterion(
  'CWR-P2-1',
  daemonRoutingProbe,
  /override/i,
  'dispatch-time routing decides by default with a UI/CLI override',
  'pnpm --filter @open-design/daemon exec vitest run routing',
);
gradeVitestCriterion(
  'CWR-P2-2',
  daemonRoutingProbe,
  /admission|budget/i,
  'admission control denies dispatch when the pre-run cost ceiling would be exceeded',
  'pnpm --filter @open-design/daemon exec vitest run routing',
);
gradeVitestCriterion(
  'CWR-P2-3',
  daemonRoutingProbe,
  /l3|deterministic.*gate/i,
  'deterministic L3 gate runner exists for lane-A (MishMash-native static) builds',
  'pnpm --filter @open-design/daemon exec vitest run routing',
);

safely(
  'CWR-P2-4',
  'pnpm exec tsx apps/daemon/src/cli.ts route --json',
  "escalation/pass rates and each lane's meter are visible via /api/routing/* and `od route --json` (HTTP-level proof deferred to the daemon test suite, see Enforcement boundaries)",
  () => {
    const run = sh('pnpm', ['exec', 'tsx', 'apps/daemon/src/cli.ts', 'route', '--json'], repoRoot, 60_000);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const laneMeters = parsed && typeof parsed.laneMeters === 'object' && parsed.laneMeters !== null ? (parsed.laneMeters as object) : null;
    const hasKeys = !!parsed && 'escalationRate' in parsed && 'passRate' in parsed && laneMeters !== null && Object.keys(laneMeters).length > 0;
    const routeMounted = /\/api\/routing/.test(readText('apps/daemon/src/server.ts') ?? '');
    const ok = run.status === 0 && hasKeys && routeMounted;
    return {
      status: ok ? 'pass' : 'fail',
      evidence: `cliExit=${run.status} parsedJson=${parsed !== null} hasRequiredKeys(escalationRate,passRate,non-empty laneMeters)=${hasKeys} routeMountedInServerTs=${routeMounted}\nstdout(first 1000 chars)=${run.stdout.slice(0, 1000)}`,
    };
  },
);

// ============================================================
// CWR-P2-5 -- selector-eval floors unchanged. Real and always-gating.
// ============================================================
safely(
  'CWR-P2-5',
  `git diff --name-only ${baseCommit}...HEAD -- evals/selector/floors.json`,
  'evals/selector/floors.json is byte-identical between baseCommit and HEAD on every run of this verifier, including this P0 run',
  () => {
    const floorsPath = 'evals/selector/floors.json';
    const touchedFloors = diffNames.includes(floorsPath);
    const floorsExistsAtBase = existsAtRef(baseCommit, floorsPath);
    return {
      status: !touchedFloors ? 'pass' : 'fail',
      evidence: `floorsExistsAtBase=${floorsExistsAtBase}; touchedInDiff=${touchedFloors}`,
    };
  },
);

// ============================================================
// HEAD-DRIFT (fresh-main leg) -- runs immediately after all behavioral
// probes, using ONLY the run-start headSha/baseCommit already known (no
// re-resolve here -- there is exactly one re-resolve in this whole run, and
// it is the FINAL one below, per fix-round-4 finding 2's literal ordering).
// ============================================================
let freshMain: 'verified' | 'stale' | 'unverifiable' = 'unverifiable';
safely(
  'HEAD-DRIFT',
  'git merge-base --is-ancestor; git ls-remote origin main; git fetch origin main',
  'the live remote main tip is fetched and confirmed an ancestor of HEAD (fail-closed); the run-start base is an ancestor of the run-start HEAD',
  () => {
    const baseIsAncestor = sh('git', ['merge-base', '--is-ancestor', baseCommit, headSha]).status === 0;

    const remoteRefs = sh('git', ['ls-remote', 'origin', 'main'], repoRoot, 30_000);
    const remoteMainSha = remoteRefs.status === 0 ? (remoteRefs.stdout.split(/\s+/)[0]?.trim() ?? null) : null;
    if (!remoteMainSha) {
      freshMain = 'unverifiable';
    } else {
      const fetchResult = sh('git', ['fetch', 'origin', 'main', '--quiet'], repoRoot, 60_000);
      if (fetchResult.status !== 0) {
        freshMain = 'unverifiable';
      } else {
        const isAncestor = sh('git', ['merge-base', '--is-ancestor', remoteMainSha, headSha]).status === 0;
        freshMain = isAncestor ? 'verified' : 'stale';
      }
    }
    const ok = baseIsAncestor && freshMain === 'verified';
    const status: 'pass' | 'fail' | 'blocked-on-founder' = ok ? 'pass' : freshMain === 'unverifiable' && baseIsAncestor ? 'blocked-on-founder' : 'fail';
    const base = {
      status,
      evidence: `[fresh-main leg] baseIsAncestor=${baseIsAncestor} freshMain=${freshMain} remoteMainSha=${remoteMainSha ?? 'null'}\nbaseCommit(run-start)=${baseCommit} head(run-start)=${headSha}`,
    };
    return freshMain === 'unverifiable'
      ? { ...base, detail: 'remote main tip could not be reached/fetched -- a human may need to confirm connectivity; an autonomous run still exits non-zero on this' }
      : base;
  },
);

// git status/dirty check -- next in the literal sequence (fix-round-4,
// finding 2), immediately after the fresh-main leg and before GATE-INTEGRITY
// phase 1. git status failure = dirty = fail, never a swallowed "clean".
const statusResult = sh('git', ['status', '--porcelain']);
const treeDirty = statusResult.status !== 0 ? true : statusResult.stdout.trim().length > 0;

// ============================================================
// Tranche register -- HEAD register always parsed; baseCommit register
// parsed only in post-landing mode, for forward-only status comparison.
// Read here, before GATE-INTEGRITY phase 1, which consumes it.
// ============================================================
interface TrancheRow {
  tranche: string;
  status: string;
  criteria: string[];
}
function parseTrancheRegister(text: string | null): TrancheRow[] {
  if (!text) return [];
  const section = extractSection(text, '## Tranche register');
  if (!section) return [];
  const rows: TrancheRow[] = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*(P\d)\s*\|\s*(open|complete)\s*\|\s*([^|]+)\|\s*$/);
    if (m) rows.push({ tranche: m[1]!, status: m[2]!, criteria: m[3]!.split(',').map((s) => s.trim()).filter(Boolean) });
  }
  return rows;
}
const headRegister = parseTrancheRegister(prdText);
const baseRegister = mode === 'post-landing' ? parseTrancheRegister(readAt(baseCommit, PRD_PATH)) : null;

// ============================================================
// GATE-INTEGRITY phase 1 -- after every criterion probe, the fresh-main leg,
// and the dirty check; before the final HEAD+base re-resolve. Cross-checks
// the PRD's register rows against CRITERION_TRANCHE (fix-round-3, finding
// 2) -- documentation must agree with the hardcoded map, but the map alone
// drives gating.
// ============================================================
function computeGateIntegrity(): { status: 'pass' | 'fail'; evidence: string } {
  const problems: string[] = [];
  const seenIds = results.map((r) => r.id);
  const nonSelfIds = ALL_CRITERION_IDS.filter((id) => id !== 'GATE-INTEGRITY');
  for (const id of nonSelfIds) {
    const matches = results.filter((r) => r.id === id);
    if (matches.length !== 1) problems.push(`${id}: ${matches.length} manifest entries (expected exactly 1)`);
  }
  for (const id of seenIds) {
    if (!nonSelfIds.includes(id) && id !== 'GATE-INTEGRITY') problems.push(`unexpected criterion id ${id} not in CRITERION_TRANCHE`);
  }
  for (const r of results) {
    if (!r.artifact || !fs.existsSync(r.artifact) || fs.statSync(r.artifact).size === 0) problems.push(`${r.id}: artifact missing or empty`);
    else if (crypto.createHash('sha256').update(fs.readFileSync(r.artifact)).digest('hex') !== r.artifactSha256) problems.push(`${r.id}: artifact hash mismatch`);
  }
  if (headRegister.length !== 3 || !['P0', 'P1', 'P2'].every((t) => headRegister.some((r) => r.tranche === t))) {
    problems.push(`Tranche register does not have exactly rows P0,P1,P2: ${JSON.stringify(headRegister.map((r) => r.tranche))}`);
  }
  for (const tranche of ['P0', 'P1', 'P2'] as const) {
    const row = headRegister.find((r) => r.tranche === tranche);
    if (!row) continue;
    const expected = idsForTranche(tranche);
    if (new Set(row.criteria).size !== row.criteria.length) problems.push(`Tranche register row ${tranche} has a duplicate criterion`);
    if (!sameSet(row.criteria, expected)) problems.push(`Tranche register row ${tranche} criteria ${JSON.stringify(row.criteria)} != CRITERION_TRANCHE-derived ${JSON.stringify(expected)}`);
  }
  const p0Row = headRegister.find((r) => r.tranche === 'P0');
  if (!p0Row || p0Row.status !== 'complete') problems.push('Tranche register P0 row is not status=complete');
  if (mode === 'post-landing' && baseRegister) {
    for (const baseRow of baseRegister) {
      const headRow = headRegister.find((r) => r.tranche === baseRow.tranche);
      if (!headRow) {
        problems.push(`tranche ${baseRow.tranche} present at baseCommit missing at HEAD`);
        continue;
      }
      if (baseRow.status === 'complete' && headRow.status !== 'complete') problems.push(`tranche ${baseRow.tranche} flipped complete -> open (forbidden)`);
    }
  }
  return {
    status: problems.length === 0 ? 'pass' : 'fail',
    evidence: problems.length === 0 ? `all ${nonSelfIds.length} criteria present exactly once, all artifacts hash-matched, register agrees with CRITERION_TRANCHE (mode=${mode})` : problems.join('\n'),
  };
}

// Non-git toolchain read, resolved before the final re-resolve so nothing
// but the phase-2 self-hash follows it (fix-round-4, finding 2).
const pnpmVersion = sh('pnpm', ['--version']).stdout.trim();

// Phase 1.
{
  const phase1 = computeGateIntegrity();
  record(
    'GATE-INTEGRITY',
    "cross-check manifest entries + Tranche register against the hardcoded CRITERION_TRANCHE map",
    'every criterion ID has exactly one manifest entry with a non-empty, hash-matched artifact; the Tranche register agrees with CRITERION_TRANCHE and is forward-only',
    phase1.status,
    phase1.evidence,
  );
}

// ============================================================
// FINAL HEAD+base re-resolve (fix-round-4, finding 2) -- the very last git
// reads of the entire run. Runs AFTER GATE-INTEGRITY phase 1 and BEFORE
// GATE-INTEGRITY phase 2; no git operation of any kind follows this point,
// only the phase-2 self-hash (fs-only) and the single manifest write.
// Replaces the HEAD-DRIFT record in place so exactly one entry survives;
// both this entry and the manifest's finalHead/finalBase fields reflect it.
// ============================================================
const finalHeadSha = gitOrFail(['rev-parse', 'HEAD']);
const finalBaseCommit = gitOrFail(['merge-base', 'origin/main', 'HEAD']);
const finalStableVsRunStart = finalHeadSha === headSha && finalBaseCommit === baseCommit;
{
  const hdIndex = results.map((r) => r.id).lastIndexOf('HEAD-DRIFT');
  const priorEntry = hdIndex >= 0 ? results[hdIndex] : undefined;
  const priorEvidence = priorEntry?.artifact && fs.existsSync(priorEntry.artifact) ? fs.readFileSync(priorEntry.artifact, 'utf8') : '(prior HEAD-DRIFT artifact unavailable)';
  const finalOk = finalStableVsRunStart && priorEntry?.status === 'pass';
  const finalStatus: 'pass' | 'fail' | 'blocked-on-founder' = finalOk ? 'pass' : priorEntry?.status === 'blocked-on-founder' && finalStableVsRunStart ? 'blocked-on-founder' : 'fail';
  if (hdIndex >= 0) results.splice(hdIndex, 1);
  record(
    'HEAD-DRIFT',
    'git rev-parse HEAD; git merge-base origin/main HEAD (FINAL re-read, immediately before the manifest write)',
    'baseCommit/HEAD resolved at start, re-checked after behavioral probes, and re-resolved one FINAL, authoritative time immediately before the manifest is written',
    finalStatus,
    `[FINAL, authoritative] finalHeadSha=${finalHeadSha} finalBaseCommit=${finalBaseCommit} finalStableVsRunStart=${finalStableVsRunStart}\n\n--- prior (post-probe) HEAD-DRIFT record ---\n${priorEvidence}`,
  );
}

// Phase 2: re-read the just-written GATE-INTEGRITY artifact from disk, not
// the in-memory value, and correct the record if the write itself was bad.
{
  const giIndex = results.map((r) => r.id).lastIndexOf('GATE-INTEGRITY');
  const giEntry = results[giIndex];
  const phase2Problems: string[] = [];
  const giEntries = results.filter((r) => r.id === 'GATE-INTEGRITY');
  if (giEntries.length !== 1) phase2Problems.push(`GATE-INTEGRITY entries after phase 1: ${giEntries.length}`);
  if (giEntry) {
    const onDisk = fs.existsSync(giEntry.artifact ?? '') ? fs.readFileSync(giEntry.artifact!) : null;
    if (!onDisk || onDisk.length === 0) phase2Problems.push('GATE-INTEGRITY artifact missing/empty on disk after write');
    else if (crypto.createHash('sha256').update(onDisk).digest('hex') !== giEntry.artifactSha256) phase2Problems.push('GATE-INTEGRITY artifact hash mismatch after write (tamper or write race)');
  } else {
    phase2Problems.push('GATE-INTEGRITY entry missing after phase 1 write');
  }
  if (phase2Problems.length > 0 && giIndex >= 0) {
    results.splice(giIndex, 1);
    record(
      'GATE-INTEGRITY',
      "cross-check manifest entries + Tranche register against the hardcoded CRITERION_TRANCHE map (phase 2 self-validation)",
      'every criterion ID has exactly one manifest entry with a non-empty, hash-matched artifact; the Tranche register agrees with CRITERION_TRANCHE and is forward-only',
      'fail',
      `phase-2 self-validation failed:\n${phase2Problems.join('\n')}`,
    );
  }
}

// -------------------------------------------------- exit-code computation --
// Gating criteria (fix-round-3, finding 2): derived from CRITERION_TRANCHE
// (the constant) + the register's open/complete STATUS per tranche name --
// NEVER from the register's own parsed criteria-per-row text. 'always-gating'
// ids gate unconditionally, independent of mode or register. Pure in-memory
// computation -- no git operation, safe at any point after the final
// re-resolve too, but placed here for readability.
const gatingCriteria = new Set<string>(ALWAYS_GATING_IDS);
if (mode === 'pre-landing') {
  for (const id of idsForTranche('P0')) gatingCriteria.add(id);
} else {
  for (const tranche of ['P0', 'P1', 'P2'] as const) {
    const row = headRegister.find((r) => r.tranche === tranche);
    if (row?.status === 'complete') for (const id of idsForTranche(tranche)) gatingCriteria.add(id);
  }
}

// Single atomic manifest write (fix-round-4, finding 2) -- the only write of
// manifest.json in the whole run. finalHeadSha/finalBaseCommit/
// finalStableVsRunStart come from the FINAL re-resolve above (the very last
// git reads of the run); treeDirty/freshMain were already resolved earlier
// in the sequence. No git operation happens between that final re-resolve
// and this write -- only the phase-2 self-hash (fs-only) in between.
const manifest = {
  wave: 'WR',
  mode,
  commit: finalHeadSha,
  baseCommit: finalBaseCommit,
  runStartCommit: headSha,
  runStartBaseCommit: baseCommit,
  finalHead: finalHeadSha,
  finalBase: finalBaseCommit,
  finalCheckStableVsRunStart: finalStableVsRunStart,
  treeDirty,
  freshMain,
  toolchain: { node: process.version, pnpm: pnpmVersion },
  trancheRegister: headRegister,
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Any non-pass status on a gating criterion blocks exit 0, including
// blocked-on-founder: a legal terminal state for a *landing* decision, but
// an autonomous run still exits non-zero on one.
const blockingFailures = results.filter((r) => r.status !== 'pass' && gatingCriteria.has(r.id));
const nonGatingFailures = results.filter((r) => r.status !== 'pass' && !gatingCriteria.has(r.id));
const passed = results.filter((r) => r.status === 'pass');

console.log(
  `\nverify-wr-routing: mode=${mode} (PROMINENT: ${mode === 'pre-landing' ? 'this wave has NOT landed to main -- gating locked to P0 only, diff locked to governance-only' : 'read from baseCommit'}); ${passed.length} pass, ${blockingFailures.length} blocking-non-pass, ${nonGatingFailures.length} non-gating-fail (open tranche) (of ${results.length}); treeDirty=${treeDirty}; freshMain=${freshMain}; finalStableVsRunStart=${finalStableVsRunStart}`,
);
for (const r of results) {
  const gating = gatingCriteria.has(r.id);
  const marker = r.status === 'pass' ? 'PASS' : gating ? `${r.status.toUpperCase()}(blocking)` : `${r.status.toUpperCase()}(non-gating,open-tranche)`;
  console.log(`  [${marker}] ${r.id} — ${r.assertion}`);
}
if (nonGatingFailures.length > 0) console.log("  ⚠ some criteria fail honestly because their owning tranche is still 'open' -- see the Tranche register. Not silent, not blocking.");
if (mode === 'pre-landing') console.log("  ⚠ mode=pre-landing: this wave has not landed to main yet. Gating is locked to P0's own criteria only, and the diff is locked to governance-only files.");
if (!finalStableVsRunStart) console.log('  ⚠ HEAD/base moved during this run -- see HEAD-DRIFT and the manifest for the authoritative final values.');
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
process.exit(blockingFailures.length === 0 && !treeDirty ? 0 : 1);
