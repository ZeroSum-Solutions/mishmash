#!/usr/bin/env tsx
// verify-wr-routing.ts -- wave WR (model routing system) mechanical verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// governed by docs/plans/waves/WR-routing.md (see VERIFICATION-CONTRACT.md,
// which this wave reuses from the mishmash-completion program even though it
// belongs to a separate plan, docs/plans/2026-08-05-model-routing-system.md)
// and is deleted, with the rest of scripts/waves/, when that program closes.
//
// FIX ROUND 1 (2026-08-05): rewritten to address GPT-5.6 Sol's REVISE verdict
// on commit a2030ef87 (10 findings, HIGH-1..6 + MED-7..10). WR-routing.md's
// "Verifier contract" section has the full prose rationale for each
// mechanism below; this header only summarizes the pin, since it is
// otherwise easy to misread as unfinished.
//
// GOVERNANCE PIN (HIGH-1): a verifier cannot embed its own resulting commit
// sha (the sha hashes the content, which would have to include the sha --
// no fixed point exists). This file ships in TWO commits: commit 1 (this fix
// round) sets GOVERNANCE_COMMIT to the sentinel 'PENDING-PIN'; commit 2,
// immediately following, changes ONLY the GOVERNANCE_COMMIT assignment line
// below to commit 1's real sha and touches nothing else in this file. From
// commit 2 forward, every check that reads "the frozen governance content"
// reads it via `git show <GOVERNANCE_COMMIT>:<path>`, never the working tree
// directly, so a later tranche cannot widen the lease or redefine a
// normative rule and still pass. The one sanctioned exception -- the pin
// line changing exactly once -- is excluded from the no-deletion self-check
// by PIN_LINE_PATTERN, not by trust (CWR-P0-4 asserts this mechanically).
//
// STATUS ENUM (HIGH-3): exactly pass | fail | blocked-on-founder, matching
// VERIFICATION-CONTRACT.md §2. The 'skip' status from the pre-fix-round-1
// version is removed. CWR-P1-*/CWR-P2-* criteria run REAL behavioral probes
// on every call (HIGH-4) -- they legitimately fail today because no P1/P2
// code exists yet, and that honest failure does not block this run's exit
// code because WR-routing.md's "Tranche register" marks P1/P2 `open`; only
// criteria owned by a `complete` tranche gate the exit code. See
// computeGatingCriteria() below.
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

// See header comment above: 'PENDING-PIN' is the sentinel used only in the
// commit that introduces this fix round. The immediately-following commit
// changes ONLY this line's right-hand side to that commit's real sha.
const GOVERNANCE_COMMIT: string = 'PENDING-PIN';
const PIN_LINE_PATTERN = /^const GOVERNANCE_COMMIT: string = /;

// ---------------------------------------------------------------- helpers --

function sh(cmd: string, args: string[], cwd: string = repoRoot, timeoutMs = 15 * 60_000): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

// Hard-fail helper (MED-8): any git command error is a verifier failure,
// never a swallowed empty string treated as "no change".
function gitOrFail(args: string[]): string {
  const r = sh('git', args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stdout.slice(0, 500)}`);
  return r.stdout.trim();
}

function readAt(commit: string, relPath: string): string | null {
  try {
    return execFileSync('git', ['show', `${commit}:${relPath}`], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return null;
  }
}

function readText(relPath: string): string | null {
  const abs = path.join(repoRoot, relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
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
// hard git failure via gitOrFail inside the criterion body) becomes an
// honest 'fail' entry instead of aborting the whole run past this one check.
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
// Real glob-intersection (fix-round-1, HIGH-2): two globs can share a path
// when one's literal prefix (everything before its first */?)  is a prefix
// of the other's -- the conservative structural check the finding asked
// for. Deny-precedence (a wave's own deny excluding the overlap) is applied
// by the caller, not here.
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
// comparison against a pinned commit's version.
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

// Real, mechanical byte-preservation proof (fix-round-1, MED-7): every
// removed/changed line in `git diff --unified=0 fromRef..toRef -- filePath`
// is a violation, except lines matching ignorePattern (the one sanctioned
// governance-pin exception).
function diffRemovals(fromRef: string, toRef: string, filePath: string, ignorePattern?: RegExp): string[] {
  const diff = sh('git', ['diff', '--unified=0', `${fromRef}..${toRef}`, '--', filePath]).stdout;
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
];
const CANONICAL_DENY: readonly string[] = [
  'apps/web/src/providers/registry.ts',
  'packages/contracts/src/api/model-routing.ts',
  'docs/plans/waves/W6a-client-website.md',
  'docs/plans/2026-08-03-client-website-studio-prd.md',
  'scripts/waves/verify-w6a-*.ts',
];

// Every real allow-glob collision this wave has with another wave's allow
// list, computed by globsIntersect() and surviving deny-precedence --
// enumerated here as the ground truth CWR-P0-3 checks the live computation
// against (fix-round-1, HIGH-2). Mirrors WR-routing.md's "Lease" section
// tables A and B exactly.
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
];

const OVERLAP_FILES: readonly string[] = [
  'apps/daemon/src/cli.ts',
  'apps/daemon/src/server.ts',
  'scripts/waves/capability-manifest.json',
  'scripts/guard.ts',
  'packages/contracts/src/index.ts',
  'apps/web/src/components/AssistantMessage.tsx',
];

const FROZEN_SECTION_HEADINGS: readonly string[] = [
  '## Routing-key fallback (normative)',
  '## Screenshot-baseline rules (normative)',
  '## Lease',
  '## Explicitly out of scope',
  '## Success criteria',
];

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

// ------------------------------------------------------- git state (start) --
// Resolved once, hard-fail on error (MED-8). Re-resolved at the very end by
// HEAD-DRIFT to detect a concurrent commit landing mid-run.
let headSha: string;
let baseCommit: string;
try {
  headSha = gitOrFail(['rev-parse', 'HEAD']);
  baseCommit = gitOrFail(['merge-base', 'origin/main', 'HEAD']);
} catch (error) {
  console.error(`verify-wr-routing: FATAL git resolution error at start -- ${String(error)}`);
  process.exit(1);
}
const diffNames = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]).stdout.trim().split('\n').filter(Boolean);

// ============================================================
// CWR-P0-1 -- wave identity document is complete and structurally sound.
// ============================================================
const prdText = readText(PRD_PATH);
{
  const requiredMarkers: [string, RegExp][] = [
    ['identity header names the wave and slug', /^# Wave WR — Model routing system/m],
    ['slug line', /\*\*Slug:\*\* `wr-routing`/],
    ["fix round 1 review status recorded", /fix round 1, addressing GPT-5\.6 Sol's REVISE verdict on commit `a2030ef87`/],
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
    ['tranche register section', /^## Tranche register$/m],
    ['tranche register grading rule (HIGH-3)', /Grading rule \(fix-round-1, HIGH-3, replacing the removed `skip` status\)/],
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
    ['governance-pin freeze subsection (HIGH-1)', /^### Governance-pin freeze \(fix-round-1, HIGH-1\)$/m],
    ['two-commit pin mechanism described', /Two commits: content-freeze, then a pin-only follow-up\./],
    ['fresh-main + hard-fail git state subsection (MED-8)', /^### Fresh-main \+ hard-fail git state \(fix-round-1, MED-8\)$/m],
    ['byte-preservation subsection (MED-7)', /^### Byte-preservation \(fix-round-1, MED-7\)$/m],
    ['real lease-collision detection subsection (HIGH-2)', /^### Real lease-collision detection \(fix-round-1, HIGH-2\)$/m],
    ['behavioral probes subsection (HIGH-4)', /^### Behavioral probes, not shape checks \(fix-round-1, HIGH-4\)$/m],
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
// leases.json parse (used by CWR-P0-2, CWR-P0-3, CWR-P0-4, LEASE).
// ============================================================
interface WaveLeaseEntry2 extends WaveLeaseEntry {}
let leasesJson: LeasesFile | null = null;
{
  const raw = readText(LEASES_PATH);
  try {
    leasesJson = raw ? (JSON.parse(raw) as LeasesFile) : null;
  } catch {
    leasesJson = null;
  }
}
const wavesRecord: Record<string, WaveLeaseEntry2> = leasesJson?.waves ?? {};
const wrLease: WaveLeaseEntry2 | undefined = wavesRecord.WR;
const allowStr: readonly string[] = wrLease && Array.isArray(wrLease.allow) ? (wrLease.allow as string[]) : CANONICAL_ALLOW;
const denyStr: readonly string[] = wrLease && Array.isArray(wrLease.deny) ? (wrLease.deny as string[]) : CANONICAL_DENY;

// ============================================================
// CWR-P0-2 -- lease matches the PRD's own declared JSON block, and both
// match the canonical lists defined in this file.
// ============================================================
{
  const problems: string[] = [];
  if (!leasesJson) problems.push(`${LEASES_PATH} missing or invalid JSON`);
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
// with deny-precedence (fix-round-1, HIGH-2).
// ============================================================
safely(
  'CWR-P0-3',
  'globsIntersect() every WR.allow entry against every other wave allow entry in leases.json, deny-precedence applied',
  'every surviving allow-glob intersection with another wave is one of the documented overlaps; both denied files are absent from allow and present in deny',
  () => {
    const problems: string[] = [];
    const otherWaves = Object.entries(wavesRecord).filter(([name]) => name !== 'WR');
    const found = new Map<string, Overlap>();
    for (const ourGlob of allowStr) {
      for (const [waveName, lease] of otherWaves) {
        const theirAllow = Array.isArray(lease.allow) ? (lease.allow as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        const theirDeny = Array.isArray(lease.deny) ? (lease.deny as unknown[]).filter((x): x is string => typeof x === 'string') : [];
        for (const theirGlob of theirAllow) {
          if (!globsIntersect(ourGlob, theirGlob)) continue;
          const deniedByOwner = theirDeny.some((d) => globsIntersect(d, ourGlob));
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
          ? `checked ${allowStr.length} allow entries against ${otherWaves.length} other wave leases; ${foundList.length} real intersections, all documented; denies verified: ${CANONICAL_DENY.join(', ')}`
          : problems.join('\n'),
    };
  },
);

// ============================================================
// CWR-P0-4 -- governance content is pinned and un-widened (fix-round-1,
// HIGH-1).
// ============================================================
safely(
  'CWR-P0-4',
  `git show <GOVERNANCE_COMMIT>:{${LEASES_PATH},${PRD_PATH},${VERIFIER_PATH}}`,
  "leases.json's WR entry and this document's frozen sections are byte-identical to their GOVERNANCE_COMMIT versions; verify-wr-routing.ts has added no deletions since GOVERNANCE_COMMIT except the sanctioned pin-line change",
  () => {
    if (GOVERNANCE_COMMIT === 'PENDING-PIN') {
      return {
        status: 'fail',
        evidence:
          'GOVERNANCE_COMMIT is still the PENDING-PIN sentinel. This is the EXPECTED state only for the commit that introduces this fix round; the immediately-following one-line pin commit sets the real sha, after which this criterion is graded for real.',
      };
    }
    const problems: string[] = [];
    const pinnedLeasesText = readAt(GOVERNANCE_COMMIT, LEASES_PATH);
    let pinnedWr: WaveLeaseEntry | undefined;
    try {
      pinnedWr = pinnedLeasesText ? (JSON.parse(pinnedLeasesText) as LeasesFile).waves?.WR : undefined;
    } catch {
      pinnedWr = undefined;
    }
    if (!pinnedWr) problems.push(`cannot read leases.json waves.WR at GOVERNANCE_COMMIT=${GOVERNANCE_COMMIT}`);
    else {
      const pAllow = Array.isArray(pinnedWr.allow) ? (pinnedWr.allow as string[]) : [];
      const pDeny = Array.isArray(pinnedWr.deny) ? (pinnedWr.deny as string[]) : [];
      if (!sameSet(pAllow, allowStr)) problems.push('leases.json WR.allow at HEAD differs from its GOVERNANCE_COMMIT version -- the lease was widened or narrowed after freeze');
      if (!sameSet(pDeny, denyStr)) problems.push('leases.json WR.deny at HEAD differs from its GOVERNANCE_COMMIT version');
    }
    const pinnedPrd = readAt(GOVERNANCE_COMMIT, PRD_PATH);
    for (const heading of FROZEN_SECTION_HEADINGS) {
      const pinnedSection = pinnedPrd ? extractSection(pinnedPrd, heading) : null;
      const headSection = prdText ? extractSection(prdText, heading) : null;
      if (pinnedSection === null || headSection === null || pinnedSection !== headSection) {
        problems.push(`frozen section "${heading}" differs from its GOVERNANCE_COMMIT version (or is missing at one end)`);
      }
    }
    const removals = diffRemovals(GOVERNANCE_COMMIT, 'HEAD', VERIFIER_PATH, PIN_LINE_PATTERN);
    if (removals.length > 0) {
      problems.push(`verify-wr-routing.ts has ${removals.length} disallowed removed/changed line(s) since GOVERNANCE_COMMIT beyond the sanctioned pin-line exception:\n${removals.slice(0, 10).join('\n')}`);
    }
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `governance content matches GOVERNANCE_COMMIT=${GOVERNANCE_COMMIT} exactly (frozen sections + lease + additive-only verifier diff)` : problems.join('\n'),
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
// HEAD-DRIFT -- fresh-main ancestry, hard-fail git state, re-resolved
// unchanged at the end (fix-round-1, MED-8; fresh-main is HIGH-5(a)).
// ============================================================
safely(
  'HEAD-DRIFT',
  "git rev-parse HEAD; git merge-base origin/main HEAD; git merge-base --is-ancestor; git ls-remote --exit-code origin main",
  'baseCommit/HEAD resolved at start and unchanged at end; origin/main is an ancestor of HEAD (fresh-main); any git command error fails the run; origin/main fetchability is recorded honestly',
  () => {
    const endHeadSha = gitOrFail(['rev-parse', 'HEAD']);
    const endBaseCommit = gitOrFail(['merge-base', 'origin/main', 'HEAD']);
    const stable = endHeadSha === headSha && endBaseCommit === baseCommit;
    const baseIsAncestor = sh('git', ['merge-base', '--is-ancestor', baseCommit, headSha]).status === 0;
    const originIsAncestorOfHead = sh('git', ['merge-base', '--is-ancestor', 'origin/main', headSha]).status === 0;
    const fetchProbe = sh('git', ['ls-remote', '--exit-code', 'origin', 'main'], repoRoot, 30_000);
    const originMainFetchable = fetchProbe.status === 0;
    const ok = stable && baseIsAncestor && originIsAncestorOfHead;
    return {
      status: ok ? 'pass' : 'fail',
      evidence: `stable=${stable} baseIsAncestor=${baseIsAncestor} originIsAncestorOfHead(fresh-main)=${originIsAncestorOfHead} originMainFetchable=${originMainFetchable}${originMainFetchable ? '' : ' (recorded as stale/offline; not hard-failed, per MED-8)'}\nbaseCommit=${baseCommit} head=${headSha} endBase=${endBaseCommit} endHead=${endHeadSha}`,
    };
  },
);

// ============================================================
// BYTE-PRESERVE -- overlap files are additive-only since baseCommit
// (fix-round-1, MED-7).
// ============================================================
safely(
  'BYTE-PRESERVE',
  `git diff --unified=0 ${baseCommit}..HEAD -- <each overlap file>`,
  'every overlap file has zero removed/changed lines since baseCommit -- additive only',
  () => {
    const problems: string[] = [];
    for (const f of OVERLAP_FILES) {
      if (!fs.existsSync(path.join(repoRoot, f))) continue;
      const removals = diffRemovals(baseCommit, 'HEAD', f);
      if (removals.length > 0) problems.push(`${f}: ${removals.length} removed/changed line(s):\n${removals.slice(0, 5).join('\n')}`);
    }
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `zero removed/changed lines across all ${OVERLAP_FILES.length} overlap files since baseCommit=${baseCommit}` : problems.join('\n\n'),
    };
  },
);

// ============================================================
// Behavioral probes (fix-round-1, HIGH-4). Real test/CLI invocations, never
// filename/source-shape checks. They legitimately fail today because P1/P2
// code does not exist yet -- see the Tranche register for why that does not
// block this run's exit code.
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
  `grep routingPolicyVersion ${'apps/daemon/src/backup/create.ts'}; test -f packages/contracts/src/api/routing-telemetry.ts`,
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
  "escalation/pass rates and each lane's meter are visible via /api/routing/* and `od route --json`",
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
// CWR-P2-5 -- selector-eval floors unchanged. Real and always-gating: this
// needs no implementation, only a diff.
// ============================================================
{
  const floorsPath = 'evals/selector/floors.json';
  const touchedFloors = diffNames.includes(floorsPath);
  const floorsExistsAtBase = sh('git', ['cat-file', '-e', `${baseCommit}:${floorsPath}`]).status === 0;
  record(
    'CWR-P2-5',
    `git diff --name-only ${baseCommit}...HEAD -- ${floorsPath}`,
    'evals/selector/floors.json is byte-identical between baseCommit and HEAD on every run of this verifier, including this P0 run',
    !touchedFloors ? 'pass' : 'fail',
    `floorsExistsAtBase=${floorsExistsAtBase}; touchedInDiff=${touchedFloors}`,
  );
}

// ============================================================
// Tranche register (fix-round-1, HIGH-3) -- parsed from the CURRENT commit;
// determines which criteria gate this run's exit code.
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
const pinnedRegister = GOVERNANCE_COMMIT !== 'PENDING-PIN' ? parseTrancheRegister(readAt(GOVERNANCE_COMMIT, PRD_PATH)) : null;

// ============================================================
// GATE-INTEGRITY -- every criterion has exactly one manifest entry with a
// non-empty, hash-matched artifact; the Tranche register is internally
// self-consistent and, if pinned, forward-only relative to GOVERNANCE_COMMIT.
// ============================================================
{
  const expectedIds = ['CWR-P0-1', 'CWR-P0-2', 'CWR-P0-3', 'CWR-P0-4', 'CWR-P1-1', 'CWR-P1-2', 'CWR-P1-3', 'CWR-P2-1', 'CWR-P2-2', 'CWR-P2-3', 'CWR-P2-4', 'CWR-P2-5', 'LEASE', 'HEAD-DRIFT', 'BYTE-PRESERVE'];
  const registerExpectedIds = [...expectedIds, 'GATE-INTEGRITY'];
  const problems: string[] = [];
  const seenIds = results.map((r) => r.id);
  for (const id of expectedIds) {
    const matches = results.filter((r) => r.id === id);
    if (matches.length !== 1) problems.push(`${id}: ${matches.length} manifest entries (expected exactly 1)`);
  }
  for (const id of seenIds) {
    if (!expectedIds.includes(id) && id !== 'GATE-INTEGRITY') problems.push(`unexpected criterion id ${id} not in WR-routing.md's Success criteria table`);
  }
  for (const r of results) {
    if (!r.artifact || !fs.existsSync(r.artifact) || fs.statSync(r.artifact).size === 0) problems.push(`${r.id}: artifact missing or empty`);
    else if (crypto.createHash('sha256').update(fs.readFileSync(r.artifact)).digest('hex') !== r.artifactSha256) problems.push(`${r.id}: artifact hash mismatch`);
  }
  // Register self-consistency.
  if (headRegister.length !== 3 || !['P0', 'P1', 'P2'].every((t) => headRegister.some((r) => r.tranche === t))) {
    problems.push(`Tranche register does not have exactly rows P0,P1,P2: ${JSON.stringify(headRegister.map((r) => r.tranche))}`);
  }
  const p0Row = headRegister.find((r) => r.tranche === 'P0');
  if (!p0Row || p0Row.status !== 'complete') problems.push('Tranche register P0 row is not status=complete');
  const allCriteriaInRegister = headRegister.flatMap((r) => r.criteria);
  if (new Set(allCriteriaInRegister).size !== allCriteriaInRegister.length) problems.push('Tranche register has a duplicate criterion across rows');
  if (!sameSet(allCriteriaInRegister, registerExpectedIds)) problems.push(`Tranche register criteria union ${JSON.stringify(allCriteriaInRegister)} != expected ${JSON.stringify(registerExpectedIds)}`);
  // Forward-only status, frozen criteria-per-complete-tranche, vs pin.
  if (pinnedRegister) {
    for (const pinnedRow of pinnedRegister) {
      const headRow = headRegister.find((r) => r.tranche === pinnedRow.tranche);
      if (!headRow) {
        problems.push(`tranche ${pinnedRow.tranche} present at GOVERNANCE_COMMIT missing at HEAD`);
        continue;
      }
      if (pinnedRow.status === 'complete' && headRow.status !== 'complete') problems.push(`tranche ${pinnedRow.tranche} flipped complete -> open (forbidden)`);
      if (headRow.status === 'complete' && !sameSet(headRow.criteria, pinnedRow.criteria)) {
        problems.push(`tranche ${pinnedRow.tranche} is complete but its owned-criteria list changed since GOVERNANCE_COMMIT`);
      }
    }
  }
  record(
    'GATE-INTEGRITY',
    "cross-check manifest entries against WR-routing.md's Success criteria table and Tranche register",
    'every criterion ID has exactly one manifest entry with a non-empty, hash-matched artifact; the Tranche register is self-consistent and forward-only',
    problems.length === 0 ? 'pass' : 'fail',
    problems.length === 0 ? `all ${expectedIds.length} criteria present exactly once, all artifacts hash-matched, register self-consistent` : problems.join('\n'),
  );
}

// -------------------------------------------------- exit-code computation --
// Only criteria owned by a `complete` tranche in the CURRENT register gate
// the exit code (fix-round-1, HIGH-3). An `open` tranche's honest failures
// are recorded in the manifest but never block this run.
const gatingCriteria = new Set(headRegister.filter((r) => r.status === 'complete').flatMap((r) => r.criteria));
const treeDirty = sh('git', ['status', '--porcelain']).stdout.trim().length > 0;
const manifest = {
  wave: 'WR',
  commit: headSha,
  treeDirty,
  baseCommit,
  governanceCommit: GOVERNANCE_COMMIT,
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  trancheRegister: headRegister,
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const blockingFailures = results.filter((r) => r.status === 'fail' && gatingCriteria.has(r.id));
const nonGatingFailures = results.filter((r) => r.status === 'fail' && !gatingCriteria.has(r.id));
const passed = results.filter((r) => r.status === 'pass');

console.log(`\nverify-wr-routing: ${passed.length} pass, ${blockingFailures.length} blocking-fail, ${nonGatingFailures.length} non-gating-fail (open tranche) (of ${results.length}); treeDirty=${treeDirty}; GOVERNANCE_COMMIT=${GOVERNANCE_COMMIT}`);
for (const r of results) {
  const gating = gatingCriteria.has(r.id);
  const marker = r.status === 'pass' ? 'PASS' : gating ? 'FAIL(blocking)' : 'FAIL(non-gating,open-tranche)';
  console.log(`  [${marker}] ${r.id} — ${r.assertion}`);
}
if (nonGatingFailures.length > 0) console.log(`  ⚠ ${nonGatingFailures.length} criteria fail honestly because their owning tranche is still 'open' -- see the Tranche register. Not silent, not blocking.`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
process.exit(blockingFailures.length === 0 && !treeDirty ? 0 : 1);
