#!/usr/bin/env tsx
// verify-wr-routing.ts -- wave WR (model routing system) mechanical verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// governed by docs/plans/waves/WR-routing.md (see VERIFICATION-CONTRACT.md,
// which this wave reuses from the mishmash-completion program even though it
// belongs to a separate plan, docs/plans/2026-08-05-model-routing-system.md)
// and is deleted, with the rest of scripts/waves/, when that program closes.
//
// FIX ROUND 2 (2026-08-05): rewritten to address GPT-5.6 Sol's second REVISE
// verdict. Round 1's GOVERNANCE_COMMIT two-commit pin did not survive review:
// a verifier on an unlanded branch cannot fully self-attest -- any pin it
// stores in its own commit history is a floating self-attestation, because
// the branch containing the pin is exactly the branch whose content the pin
// is supposed to constrain. That machinery (GOVERNANCE_COMMIT,
// PIN_LINE_PATTERN, the two-commit sequence) is deleted entirely.
//
// BASE-ANCHORED GOVERNANCE, WITH AN EXPLICIT PRE-LANDING MODE: this verifier
// now reads governance (the WR lease entry, every OTHER wave's lease entry,
// the normative PRD sections, the Tranche register baseline) from
// `baseCommit` (merge-base with origin/main) -- exactly like every other
// wave verifier in this repo. That is fully sound once this wave's P0 has
// landed to main. Pre-landing (the actual current state: no `WR` key exists
// in leases.json at baseCommit yet), the verifier reads its own governance
// from HEAD instead, records `mode: "pre-landing"` prominently in the
// manifest, and -- per WR-routing.md's Tranche-entry gate rule 4 -- locks
// gating to P0's own criteria only, regardless of what the Tranche register
// claims for P1/P2. This makes the pre-landing state non-exploitable: no
// product-shaped tranche can ever be graded as passing while this wave's own
// governance is unlanded. The landing PR's own adversarial review is the
// enforcement surface for the governance content itself while pre-landing --
// this verifier says so honestly instead of manufacturing a self-issued pin.
//
// STATUS ENUM: exactly pass | fail | blocked-on-founder, matching
// VERIFICATION-CONTRACT.md §2. Any non-pass status on a gating criterion
// blocks exit 0, including blocked-on-founder (a legal terminal state for
// *landing* decisions, but this autonomous run still exits non-zero on one).
// GATE-INTEGRITY and LEASE-INTEGRITY are unconditionally gating regardless
// of tranche/mode -- see WR-routing.md's Tranche register grading rule.
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

// Hard-fail helper (fix-round-1 MED-8, extended fix-round-2 point 9): any
// proof-bearing git command error is a verifier failure, never a swallowed
// empty string treated as "no change".
function gitOrFail(args: string[], timeoutMs?: number): string {
  const r = sh('git', args, repoRoot, timeoutMs);
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

function existsAtRef(ref: string, relPath: string): boolean {
  return sh('git', ['cat-file', '-e', `${ref}:${relPath}`]).status === 0;
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
function isLiteralGlob(glob: string): boolean {
  return !/[*?]/.test(glob);
}
// Real glob-intersection (fix-round-1, HIGH-2): two globs can share a path
// when one's literal prefix (everything before its first */?) is a prefix
// of the other's -- the conservative structural check the finding asked
// for. DELIBERATELY CONSERVATIVE (over-inclusive) by design: prefix
// containment can flag two globs as intersecting even where their true
// match sets never actually overlap for every possible path (e.g. two
// different literal segments after a shared wildcard boundary would still
// need per-path checking to disprove) -- that is the correct failure
// direction here, since a false positive costs a line of documentation and
// a false negative costs a silent write conflict (fix-round-2, partial-2).
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

// Real, mechanical byte-preservation proof (fix-round-1, MED-7): every
// removed/changed line in `git diff --unified=0 fromRef..toRef -- filePath`
// is a violation, except lines matching ignorePattern. Hard-fails on a git
// error (fix-round-2, point 9) instead of silently reading an empty diff as
// "no changes".
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
// list, computed by globsIntersect() and surviving corrected deny-precedence
// -- enumerated here as the ground truth CWR-P0-3 checks the live
// computation against. Mirrors WR-routing.md's "Lease" section tables A/B.
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
// Resolved once, hard-fail on error. Re-resolved by HEAD-DRIFT AFTER all
// behavioral probes complete (fix-round-2, point 13) to catch mid-run drift.
let headSha: string;
let baseCommit: string;
try {
  headSha = gitOrFail(['rev-parse', 'HEAD']);
  baseCommit = gitOrFail(['merge-base', 'origin/main', 'HEAD']);
} catch (error) {
  console.error(`verify-wr-routing: FATAL git resolution error at start -- ${String(error)}`);
  process.exit(1);
}
const diffNames = gitOrFail(['diff', '--name-only', `${baseCommit}...HEAD`]).split('\n').filter(Boolean);

// ============================================================
// Mode detection (fix-round-2, point A) -- read leases.json at baseCommit;
// a WR key there means this wave's governance has landed to main.
// ============================================================
interface WaveLeaseEntry2 extends WaveLeaseEntry {}
function parseLeasesText(text: string | null): LeasesFile | null {
  try {
    return text ? (JSON.parse(text) as LeasesFile) : null;
  } catch {
    return null;
  }
}
const headLeasesJson = parseLeasesText(readText(LEASES_PATH));
const headWavesRecord: Record<string, WaveLeaseEntry2> = headLeasesJson?.waves ?? {};
const wrLease: WaveLeaseEntry2 | undefined = headWavesRecord.WR;
const allowStr: readonly string[] = wrLease && Array.isArray(wrLease.allow) ? (wrLease.allow as string[]) : CANONICAL_ALLOW;
const denyStr: readonly string[] = wrLease && Array.isArray(wrLease.deny) ? (wrLease.deny as string[]) : CANONICAL_DENY;

const baseLeasesJson = parseLeasesText(readAt(baseCommit, LEASES_PATH));
const baseWavesRecord: Record<string, WaveLeaseEntry2> = baseLeasesJson?.waves ?? {};
const baseWrLease: WaveLeaseEntry2 | undefined = baseWavesRecord.WR;
const mode: 'pre-landing' | 'post-landing' = baseWrLease ? 'post-landing' : 'pre-landing';

// ============================================================
// CWR-P0-1 -- wave identity document is complete and structurally sound.
// ============================================================
const prdText = readText(PRD_PATH);
{
  const requiredMarkers: [string, RegExp][] = [
    ['identity header names the wave and slug', /^# Wave WR — Model routing system/m],
    ['slug line', /\*\*Slug:\*\* `wr-routing`/],
    ['fix round 2 review status recorded', /fix round 2 \(final before escalation/],
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
    ['P0-must-land-first rule (fix-round-2)', /P0 \(governance\) must have landed to `main` first \(fix-round-2, root-cause fix\)/],
    ['tranche register section', /^## Tranche register$/m],
    ['tranche register grading rule (HIGH-3)', /Grading rule \(fix-round-1, HIGH-3, replacing the removed `skip` status\)/],
    ['GATE-INTEGRITY/LEASE-INTEGRITY unconditional gating (new-HIGH-2)', /GATE-INTEGRITY.*and.*LEASE-INTEGRITY.*are the sole exceptions/],
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
    ['base-anchored governance subsection (fix-round-2)', /^### Base-anchored governance, with an explicit pre-landing mode \(fix-round-2, replaces the round-1 two-commit pin\)$/m],
    ['mode detection described', /\*\*Mode detection\.\*\*/],
    ['pre-landing mode described', /\*\*`mode: "pre-landing"`\*\*/],
    ['fresh-main fail-closed subsection', /^### Fresh-main, fail-closed \(fix-round-1, MED-8; hardened fix-round-2, new-HIGH-4\)$/m],
    ['byte-preservation unconditional subsection', /^### Byte-preservation, unconditional \(fix-round-1, MED-7; hardened fix-round-2, new-HIGH-3\)$/m],
    ['lease-collision corrected deny-precedence subsection', /^### Real lease-collision detection, with corrected deny-precedence \(fix-round-1, HIGH-2; corrected fix-round-2, partial-2\)$/m],
    ['behavioral probes subsection', /^### Behavioral probes, not shape checks \(fix-round-1, HIGH-4\)$/m],
    ['gate-integrity two-phase subsection', /^### GATE-INTEGRITY runs last, as a two-phase write \(fix-round-2, LOW-8\)$/m],
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
// match the canonical lists defined in this file. Mode-independent: this is
// HEAD-internal consistency, not a freeze check.
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
// with CORRECTED deny-precedence (fix-round-2, partial-2). Other waves'
// leases are read from baseCommit (fix-round-2, point A.1) -- their
// content is always already on main, in both modes.
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
          // Corrected deny-precedence (fix-round-2): only excludes when OUR
          // glob is a literal path (no wildcard) AND their deny pattern
          // actually regex-matches it -- a deny only narrows the paths it
          // matches, never the whole overlap by mere prefix intersection.
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
// landed (fix-round-2, replaces the round-1 GOVERNANCE_COMMIT pin).
// ============================================================
safely(
  'CWR-P0-4',
  `mode=${mode}; git show <baseCommit>:{${LEASES_PATH},${PRD_PATH}}`,
  "in pre-landing mode, nothing to freeze against yet (pass, enforced instead by the landing PR's review); once post-landing, leases.json's WR entry and this document's frozen sections are byte-identical to their baseCommit versions",
  () => {
    if (mode === 'pre-landing') {
      return {
        status: 'pass',
        evidence:
          `mode=pre-landing: no WR key exists in leases.json@baseCommit=${baseCommit} -- this wave's governance has not landed to main yet, so there is nothing to freeze against. ` +
          'This is the expected, stable state (not a transient/incomplete one): pinning becomes enforceable the moment P0 lands. Until then the landing PR\'s own adversarial review is the enforcement surface for the governance content itself. ' +
          'Per the Tranche-entry gate rule 4, gating is hardcoded to P0\'s own criteria only while mode=pre-landing, so this pass carries no risk of a product tranche free-riding on it.',
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
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `mode=post-landing: governance content matches baseCommit=${baseCommit} exactly (frozen sections + WR lease entry)` : problems.join('\n'),
    };
  },
);

// ============================================================
// LEASE-INTEGRITY -- every OTHER wave's lease entry is byte-identical
// between baseCommit and HEAD (fix-round-2, new-HIGH-5). Unconditionally
// gating regardless of tranche/mode.
// ============================================================
safely(
  'LEASE-INTEGRITY',
  `diff leases.json@baseCommit vs HEAD for every waves.* key except WR`,
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
// BYTE-PRESERVE -- overlap files are additive-only and never deleted since
// baseCommit (fix-round-1, MED-7; hardened fix-round-2, new-HIGH-3).
// ============================================================
safely(
  'BYTE-PRESERVE',
  `git cat-file -e <ref>:<file>; git diff --unified=0 ${baseCommit}..HEAD -- <each overlap file>`,
  'every overlap file that existed at baseCommit still exists at HEAD (missing = unconditional fail) and has zero removed/changed lines since baseCommit',
  () => {
    const problems: string[] = [];
    for (const f of OVERLAP_FILES) {
      const existedAtBase = existsAtRef(baseCommit, f);
      if (!existedAtBase) continue;
      const existsAtHead = existsAtRef('HEAD', f);
      if (!existsAtHead) {
        problems.push(`${f}: existed at baseCommit=${baseCommit} but is MISSING at HEAD (deleted) -- unconditional fail`);
        continue;
      }
      const removals = diffRemovals(baseCommit, 'HEAD', f);
      if (removals.length > 0) problems.push(`${f}: ${removals.length} removed/changed line(s):\n${removals.slice(0, 5).join('\n')}`);
    }
    return {
      status: problems.length === 0 ? 'pass' : 'fail',
      evidence: problems.length === 0 ? `zero removed/changed lines and zero deletions across all ${OVERLAP_FILES.length} overlap files since baseCommit=${baseCommit}` : problems.join('\n\n'),
    };
  },
);

// ============================================================
// Behavioral probes (fix-round-1, HIGH-4). Real test/CLI invocations, never
// filename/source-shape checks. They legitimately fail today because P1/P2
// code does not exist yet -- see the Tranche register for why that does not
// block this run's exit code. Suite QUALITY is a review boundary, not a
// verifier boundary -- see WR-routing.md "Enforcement boundaries".
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
  `grep routingPolicyVersion apps/daemon/src/backup/create.ts; test -f packages/contracts/src/api/routing-telemetry.ts`,
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
// CWR-P2-5 -- selector-eval floors unchanged. Real and always-gating: this
// needs no implementation, only a diff.
// ============================================================
{
  const floorsPath = 'evals/selector/floors.json';
  const touchedFloors = diffNames.includes(floorsPath);
  const floorsExistsAtBase = existsAtRef(baseCommit, floorsPath);
  record(
    'CWR-P2-5',
    `git diff --name-only ${baseCommit}...HEAD -- ${floorsPath}`,
    'evals/selector/floors.json is byte-identical between baseCommit and HEAD on every run of this verifier, including this P0 run',
    !touchedFloors ? 'pass' : 'fail',
    `floorsExistsAtBase=${floorsExistsAtBase}; touchedInDiff=${touchedFloors}`,
  );
}

// ============================================================
// HEAD-DRIFT -- runs AFTER all behavioral probes (fix-round-2, point 13):
// fresh-main is now fail-closed (new-HIGH-4), and baseCommit/HEAD are
// re-resolved here to catch a concurrent commit landing mid-run, including
// during the (potentially slow) probes above.
// ============================================================
let freshMain: 'verified' | 'stale' | 'unverifiable' = 'unverifiable';
safely(
  'HEAD-DRIFT',
  'git rev-parse HEAD; git merge-base origin/main HEAD; git merge-base --is-ancestor; git ls-remote origin main; git fetch origin main',
  'baseCommit/HEAD resolved at start and unchanged after all behavioral probes complete; the live remote main tip is fetched and confirmed an ancestor of HEAD (fail-closed); any git command error fails the run',
  () => {
    const endHeadSha = gitOrFail(['rev-parse', 'HEAD']);
    const endBaseCommit = gitOrFail(['merge-base', 'origin/main', 'HEAD']);
    const stable = endHeadSha === headSha && endBaseCommit === baseCommit;
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
    // Fail-closed: "unverifiable" is a fail, not a soft pass (fix-round-2, new-HIGH-4).
    const ok = stable && baseIsAncestor && freshMain === 'verified';
    const status: 'pass' | 'fail' | 'blocked-on-founder' = ok ? 'pass' : freshMain === 'unverifiable' && stable && baseIsAncestor ? 'blocked-on-founder' : 'fail';
    const base = {
      status,
      evidence: `stable=${stable} baseIsAncestor=${baseIsAncestor} freshMain=${freshMain} remoteMainSha=${remoteMainSha ?? 'null'}\nbaseCommit=${baseCommit} head=${headSha} endBase=${endBaseCommit} endHead=${endHeadSha}`,
    };
    return freshMain === 'unverifiable'
      ? { ...base, detail: 'remote main tip could not be reached/fetched -- a human may need to confirm connectivity; an autonomous run still exits non-zero on this' }
      : base;
  },
);

// ============================================================
// Tranche register (fix-round-1, HIGH-3; base-anchored fix-round-2, point
// A.4) -- HEAD register always parsed; baseCommit register parsed only in
// post-landing mode, for forward-only comparison.
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
// GATE-INTEGRITY -- runs LAST (fix-round-2, LOW-8), after every other
// criterion including the re-resolved HEAD-DRIFT. Two-phase write: phase 1
// records from everything seen so far; phase 2 re-reads that artifact from
// disk and corrects the record if the write itself was bad.
// ============================================================
const registerExpectedIds = ['CWR-P0-1', 'CWR-P0-2', 'CWR-P0-3', 'CWR-P0-4', 'CWR-P1-1', 'CWR-P1-2', 'CWR-P1-3', 'CWR-P2-1', 'CWR-P2-2', 'CWR-P2-3', 'CWR-P2-4', 'CWR-P2-5', 'LEASE', 'LEASE-INTEGRITY', 'HEAD-DRIFT', 'BYTE-PRESERVE', 'GATE-INTEGRITY'];
const nonRegisterExpectedIds = registerExpectedIds.filter((id) => id !== 'GATE-INTEGRITY');

function computeGateIntegrity(): { status: 'pass' | 'fail'; evidence: string } {
  const problems: string[] = [];
  const seenIds = results.map((r) => r.id);
  for (const id of nonRegisterExpectedIds) {
    const matches = results.filter((r) => r.id === id);
    if (matches.length !== 1) problems.push(`${id}: ${matches.length} manifest entries (expected exactly 1)`);
  }
  for (const id of seenIds) {
    if (!nonRegisterExpectedIds.includes(id) && id !== 'GATE-INTEGRITY') problems.push(`unexpected criterion id ${id} not in WR-routing.md's Success criteria table`);
  }
  for (const r of results) {
    if (!r.artifact || !fs.existsSync(r.artifact) || fs.statSync(r.artifact).size === 0) problems.push(`${r.id}: artifact missing or empty`);
    else if (crypto.createHash('sha256').update(fs.readFileSync(r.artifact)).digest('hex') !== r.artifactSha256) problems.push(`${r.id}: artifact hash mismatch`);
  }
  if (headRegister.length !== 3 || !['P0', 'P1', 'P2'].every((t) => headRegister.some((r) => r.tranche === t))) {
    problems.push(`Tranche register does not have exactly rows P0,P1,P2: ${JSON.stringify(headRegister.map((r) => r.tranche))}`);
  }
  const p0Row = headRegister.find((r) => r.tranche === 'P0');
  if (!p0Row || p0Row.status !== 'complete') problems.push('Tranche register P0 row is not status=complete');
  const allCriteriaInRegister = headRegister.flatMap((r) => r.criteria);
  if (new Set(allCriteriaInRegister).size !== allCriteriaInRegister.length) problems.push('Tranche register has a duplicate criterion across rows');
  if (!sameSet(allCriteriaInRegister, registerExpectedIds)) problems.push(`Tranche register criteria union ${JSON.stringify(allCriteriaInRegister)} != expected ${JSON.stringify(registerExpectedIds)}`);
  if (mode === 'post-landing' && baseRegister) {
    for (const baseRow of baseRegister) {
      const headRow = headRegister.find((r) => r.tranche === baseRow.tranche);
      if (!headRow) {
        problems.push(`tranche ${baseRow.tranche} present at baseCommit missing at HEAD`);
        continue;
      }
      if (baseRow.status === 'complete' && headRow.status !== 'complete') problems.push(`tranche ${baseRow.tranche} flipped complete -> open (forbidden)`);
      if (headRow.status === 'complete' && !sameSet(headRow.criteria, baseRow.criteria)) {
        problems.push(`tranche ${baseRow.tranche} is complete but its owned-criteria list changed since baseCommit`);
      }
    }
  }
  return { status: problems.length === 0 ? 'pass' : 'fail', evidence: problems.length === 0 ? `all ${nonRegisterExpectedIds.length} criteria present exactly once, all artifacts hash-matched, register self-consistent (mode=${mode})` : problems.join('\n') };
}

// Phase 1.
{
  const phase1 = computeGateIntegrity();
  record(
    'GATE-INTEGRITY',
    "cross-check manifest entries against WR-routing.md's Success criteria table and Tranche register",
    'every criterion ID has exactly one manifest entry with a non-empty, hash-matched artifact; the Tranche register is self-consistent and forward-only',
    phase1.status,
    phase1.evidence,
  );
}
// Phase 2: re-read the just-written artifact from disk, not the in-memory
// value, and correct the record if the write itself was bad.
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
      "cross-check manifest entries against WR-routing.md's Success criteria table and Tranche register (phase 2 self-validation)",
      'every criterion ID has exactly one manifest entry with a non-empty, hash-matched artifact; the Tranche register is self-consistent and forward-only',
      'fail',
      `phase-2 self-validation failed:\n${phase2Problems.join('\n')}`,
    );
  }
}

// -------------------------------------------------- exit-code computation --
// Gating criteria (fix-round-2, point A.4 + Tranche-entry gate rule 4):
// - pre-landing mode: hardcoded to P0's own owned-criteria list, regardless
//   of what the register claims for P1/P2 -- the root-cause fix.
// - post-landing mode: every tranche marked `complete` at HEAD (a tranche
//   flipping open->complete in this diff is graded gating in this same
//   diff, per the Tranche register's rule).
// GATE-INTEGRITY and LEASE-INTEGRITY are unconditionally gating regardless
// (fix-round-2, new-HIGH-2), independent of the register entirely.
const ALWAYS_GATING = new Set(['GATE-INTEGRITY', 'LEASE-INTEGRITY']);
const gatingCriteria = new Set<string>();
if (mode === 'pre-landing') {
  const p0Row = headRegister.find((r) => r.tranche === 'P0');
  for (const id of p0Row ? p0Row.criteria : []) gatingCriteria.add(id);
} else {
  for (const row of headRegister) {
    if (row.status === 'complete') for (const id of row.criteria) gatingCriteria.add(id);
  }
}
for (const id of ALWAYS_GATING) gatingCriteria.add(id);

// git status failure = dirty = fail (fix-round-2, MED-6/point 9).
const statusResult = sh('git', ['status', '--porcelain']);
const treeDirty = statusResult.status !== 0 ? true : statusResult.stdout.trim().length > 0;

const manifest = {
  wave: 'WR',
  mode,
  commit: headSha,
  treeDirty,
  baseCommit,
  freshMain,
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  trancheRegister: headRegister,
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Any non-pass status on a gating criterion blocks exit 0, including
// blocked-on-founder (fix-round-2, MED-7): a legal terminal state for a
// *landing* decision, but an autonomous run still exits non-zero on one.
const blockingFailures = results.filter((r) => r.status !== 'pass' && (gatingCriteria.has(r.id) || ALWAYS_GATING.has(r.id)));
const nonGatingFailures = results.filter((r) => r.status !== 'pass' && !gatingCriteria.has(r.id) && !ALWAYS_GATING.has(r.id));
const passed = results.filter((r) => r.status === 'pass');

console.log(`\nverify-wr-routing: mode=${mode} (PROMINENT: ${mode === 'pre-landing' ? 'this wave has NOT landed to main -- gating locked to P0 only' : 'read from baseCommit'}); ${passed.length} pass, ${blockingFailures.length} blocking-non-pass, ${nonGatingFailures.length} non-gating-fail (open tranche) (of ${results.length}); treeDirty=${treeDirty}; freshMain=${freshMain}`);
for (const r of results) {
  const gating = gatingCriteria.has(r.id) || ALWAYS_GATING.has(r.id);
  const marker = r.status === 'pass' ? 'PASS' : gating ? `${r.status.toUpperCase()}(blocking)` : `${r.status.toUpperCase()}(non-gating,open-tranche)`;
  console.log(`  [${marker}] ${r.id} — ${r.assertion}`);
}
if (nonGatingFailures.length > 0) console.log(`  ⚠ ${nonGatingFailures.length} criteria fail honestly because their owning tranche is still 'open' -- see the Tranche register. Not silent, not blocking.`);
if (mode === 'pre-landing') console.log('  ⚠ mode=pre-landing: this wave has not landed to main yet. Gating is locked to P0\'s own criteria only; no product tranche can be evidenced as passing from this run.');
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
process.exit(blockingFailures.length === 0 && !treeDirty ? 0 : 1);
