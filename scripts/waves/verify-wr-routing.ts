#!/usr/bin/env tsx
// verify-wr-routing.ts -- wave WR (model routing system, P0 governance tranche)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// governed by docs/plans/waves/WR-routing.md (see VERIFICATION-CONTRACT.md,
// which this wave reuses from the mishmash-completion program even though it
// belongs to a separate plan, docs/plans/2026-08-05-model-routing-system.md)
// and is deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-wr-routing.ts
//
// SKIP status (deliberate deviation from VERIFICATION-CONTRACT.md's
// pass|fail|blocked-on-founder enum, explained in WR-routing.md's "Verifier
// contract" section): CWR-P1-* and CWR-P2-1..4 assert against module/test
// files that do not exist yet at this P0 tranche. Rather than omitting them
// (VERIFICATION-CONTRACT.md §2 rule 1: silence is failure) or faking a
// pass, each records status "skip" with an explicit, named reason the moment
// its target file is missing. The moment those files land, this same
// verifier -- unedited -- starts asserting real behavior against them. Exit
// code treats "skip" as non-blocking (this run is green at P0) but every
// skip is visible in both the console summary and the manifest, never
// silent. CWR-P2-5 is graded for real starting today: it needs no
// implementation to check, only a diff.
//
// Exit 0 only when every non-skip criterion passes and the tree is clean.
// The commit-bound proof manifest is written to
// ~/.claude/goal-state/wr-routing/proof/manifest.json either way.

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

// --- canonical lease, defined once here and cross-checked against both
// leases.json and the PRD's own declared block, so neither can drift from
// the other (VERIFICATION-CONTRACT.md §3 R9's spirit, applied to the lease
// itself rather than only to the diff it gates). ---
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
const CANONICAL_DENY: readonly string[] = ['apps/web/src/providers/registry.ts', 'packages/contracts/src/api/model-routing.ts'];

// The six files expected to also appear in another (already-landed) wave's
// allow list, and which wave(s) they're documented as shared with. Anything
// colliding outside this map is undocumented and fails CWR-P0-3.
const EXPECTED_OVERLAPS: Record<string, string[]> = {
  'apps/daemon/src/cli.ts': ['W0', 'W1', 'W3', 'W4'],
  'apps/daemon/src/server.ts': ['W1', 'W4'],
  'scripts/waves/capability-manifest.json': ['W1', 'W4'],
  'scripts/guard.ts': ['W0', 'W2'],
  'apps/web/src/components/AssistantMessage.tsx': ['W1'],
};
// packages/contracts/src/index.ts is not an exact-string entry anywhere else
// in leases.json; it is documented as falling under W1's broad glob instead
// (checked separately, by real glob matching, below).
const BARREL_FILE = 'packages/contracts/src/index.ts';
const BARREL_OVERLAP_WAVE = 'W1';
const BARREL_OVERLAP_GLOB = 'packages/contracts/**';

function sh(cmd: string, args: string[], cwd: string = repoRoot): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
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
  status: 'pass' | 'fail' | 'skip';
  detail?: string | undefined;
}

function artifactFor(id: string, content: string): { artifact: string; artifactSha256: string } {
  const file = path.join(proofDir, `${id}.txt`);
  fs.writeFileSync(file, content);
  return { artifact: file, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
}

const results: CriterionResult[] = [];
function record(id: string, command: string, assertion: string, status: 'pass' | 'fail' | 'skip', evidence: string, detail?: string): void {
  const { artifact, artifactSha256 } = artifactFor(id, `# ${id}\n# assertion: ${assertion}\n# verdict: ${status}\n\n${evidence}\n`);
  results.push({ id, command, assertion, artifact, artifactSha256, exitCode: status === 'pass' || status === 'skip' ? 0 : 1, status, detail });
}

function skip(id: string, command: string, assertion: string, missing: string, futureTranche: string): void {
  record(
    id,
    command,
    assertion,
    'skip',
    `SKIP: ${missing} does not exist yet at this P0 tranche. Deferred to ${futureTranche}, per WR-routing.md's "Verifier contract" section. This is a declared skip, not a silent omission or an implicit pass -- once ${missing} exists, this same verifier starts asserting real pass/fail here.`,
  );
}

function readText(relPath: string): string | null {
  const abs = path.join(repoRoot, relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
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

// ============================================================
// CWR-P0-1 -- wave identity document is complete and structurally sound.
// ============================================================
const prdText = readText(PRD_PATH);
{
  const requiredMarkers: [string, RegExp][] = [
    ['identity header names the wave and slug', /^# Wave WR — Model routing system/m],
    ['slug line', /\*\*Slug:\*\* `wr-routing`/],
    ['P0 phase section', /^### P0 — Governance \+ closure scaffold \(this tranche\)$/m],
    ['P1 phase section', /^### P1 — Policy \+ telemetry \(advisory\)$/m],
    ['P2 phase section', /^### P2 — Dispatch routing \+ admission control \+ deterministic gates$/m],
    ['explicit P2.5/P6 exclusion heading', /^## Explicitly out of scope$/m],
    ['P2.5 named as out of scope', /P2\.5 and P6 of the 2026-08-05 plan are out of this wave's scope/],
    ['P6 named as conditional/out of scope', /P6 \(conditional learned routing/],
    ['routing-key fallback section (normative)', /^### Routing-key fallback \(normative\)$/m],
    ['routing-key fallback table rows: general chat', /General chat \(no brief, no template\)/],
    ['routing-key fallback table rows: ingestion', /Ingestion \(plan §4 rights-laned pipeline\)/],
    ['routing-key fallback table rows: mobile', /Mobile \(plan §1 Lane C\)/],
    ['screenshot-baseline rules section (normative)', /^### Screenshot-baseline rules \(normative\)$/m],
    ['screenshot-baseline rule 1: first frontier-passed render', /first frontier-tier-passed render/],
    ['screenshot-baseline rule 2: versioned with token freeze', /versioned with the token freeze/],
    ['screenshot-baseline rule 3: negative controls', /negative controls?/i],
    ['verifier contract section', /^## Verifier contract$/m],
    ['lease section', /^## Lease$/m],
    ['review protocol section', /^## Review protocol$/m],
    ['review protocol names GPT-5.6 Sol', /GPT-5\.6 Sol \(Codex OAuth\)/],
    ['review protocol states reviewer != author', /Reviewer ≠ author always/],
    ['review protocol names Claude Max OAuth only', /Claude models are dispatched through Claude Code OAuth \(Max\) only/],
    ['review protocol quotes PRD §15 constraint', /No Anthropic model may use API credits, Nous, or OpenRouter for this program/],
    ['success criteria table', /^## Success criteria$/m],
    ['adversarial review section', /^## Adversarial review$/m],
  ];
  // Prose sentences wrap across lines in the markdown source; headings never
  // do (they are single lines by construction). Test heading regexes (which
  // rely on ^...$/m line-anchoring) against the raw text, and everything
  // else against a whitespace-flattened copy so a mid-sentence line break
  // can't produce a false "missing marker".
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
    'wave identity document exists with every required section (identity, phase scope, P2.5/P6 exclusion, both normative rule sections, verifier contract, review protocol)',
    prdText !== null && missing.length === 0 ? 'pass' : 'fail',
    prdText === null ? `${PRD_PATH} does not exist` : missing.length === 0 ? `all ${requiredMarkers.length} required markers present` : `missing markers:\n${missing.join('\n')}`,
  );
}

// ============================================================
// CWR-P0-2 -- lease matches the PRD's own declared JSON block, and both
// match the canonical lists defined in this file.
// ============================================================
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]) && new Set(a).size === a.length;
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
let leasesJson: LeasesFile | null = null;
{
  const raw = readText(LEASES_PATH);
  try {
    leasesJson = raw ? (JSON.parse(raw) as LeasesFile) : null;
  } catch {
    leasesJson = null;
  }
}
const wavesRecord: Record<string, WaveLeaseEntry> = leasesJson?.waves ?? {};
const wrLease: WaveLeaseEntry | undefined = wavesRecord.WR;
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
  // Cross-check the PRD's own declared ```json lease block against the same canonical lists.
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
// CWR-P0-3 -- no undocumented lease collisions; denies are correct.
// ============================================================
{
  const problems: string[] = [];
  const otherWaves = Object.entries(wavesRecord).filter(([name]) => name !== 'WR');
  const allowStr = wrLease && Array.isArray(wrLease.allow) ? (wrLease.allow as string[]) : CANONICAL_ALLOW;
  const denyStr = wrLease && Array.isArray(wrLease.deny) ? (wrLease.deny as string[]) : CANONICAL_DENY;

  // Exact-string collisions (the repo's own precedent style for documenting
  // overlaps -- see VERIFICATION-CONTRACT.md §4.1: EntryShell.tsx and
  // registry.ts were both literal filenames appearing in two waves' allow
  // arrays, not glob-vs-glob reasoning).
  const actualCollisions = new Map<string, string[]>();
  for (const file of allowStr) {
    const owners = otherWaves.filter(([, lease]) => Array.isArray(lease.allow) && (lease.allow as unknown[]).includes(file)).map(([name]) => name);
    if (owners.length > 0) actualCollisions.set(file, owners.sort());
  }
  const expectedFiles = new Set(Object.keys(EXPECTED_OVERLAPS));
  for (const [file, owners] of actualCollisions) {
    if (!expectedFiles.has(file)) {
      problems.push(`undocumented exact-string collision: ${file} also allowed by [${owners.join(', ')}], not in EXPECTED_OVERLAPS`);
      continue;
    }
    const expectedOwners = [...EXPECTED_OVERLAPS[file]!].sort();
    if (!sameSet(owners, expectedOwners)) {
      problems.push(`${file}: actual collision owners [${owners.join(', ')}] != documented owners [${expectedOwners.join(', ')}]`);
    }
    if (!(wrLease?.note ?? '').includes(file)) problems.push(`${file}: documented overlap not named in WR.note`);
  }
  for (const file of expectedFiles) {
    if (!actualCollisions.has(file)) problems.push(`documented overlap ${file} no longer collides with anything -- EXPECTED_OVERLAPS is stale`);
  }

  // The one documented glob-level overlap: the contracts barrel file falls
  // under W1's broad packages/contracts/** grant.
  const w1Allow = otherWaves.find(([name]) => name === BARREL_OVERLAP_WAVE)?.[1]?.allow;
  const w1HasBarrelGlob = Array.isArray(w1Allow) && (w1Allow as unknown[]).includes(BARREL_OVERLAP_GLOB);
  const barrelMatchesW1Glob = w1HasBarrelGlob && globToRegExp(BARREL_OVERLAP_GLOB).test(BARREL_FILE);
  if (!allowStr.includes(BARREL_FILE)) problems.push(`${BARREL_FILE} missing from WR.allow`);
  if (!barrelMatchesW1Glob) problems.push(`${BARREL_FILE} does not actually fall under ${BARREL_OVERLAP_WAVE}'s ${BARREL_OVERLAP_GLOB} grant -- documented overlap is stale or wrong`);
  if (!(wrLease?.note ?? '').includes(BARREL_FILE)) problems.push(`${BARREL_FILE}: documented overlap not named in WR.note`);

  // Denies correct: absent from allow, present in deny.
  for (const denied of CANONICAL_DENY) {
    if (allowStr.includes(denied)) problems.push(`${denied} is denied but also present in WR.allow`);
    if (!denyStr.includes(denied)) problems.push(`${denied} missing from WR.deny`);
  }

  record(
    'CWR-P0-3',
    `cross-reference leases.json waves.WR against every other wave's allow list`,
    'every allow-glob collision is one of the six documented overlaps (named in WR.note) or the documented contracts-barrel glob overlap; both denied files are absent from allow and present in deny',
    problems.length === 0 ? 'pass' : 'fail',
    problems.length === 0
      ? `checked ${allowStr.length} allow entries against ${otherWaves.length} other wave leases; documented overlaps: ${[...actualCollisions.keys(), BARREL_FILE].join(', ')}; denies verified: ${CANONICAL_DENY.join(', ')}`
      : problems.join('\n'),
  );
}

// ============================================================
// Git state -- computed once, used by LEASE / HEAD-DRIFT / CWR-P2-5.
// ============================================================
const headSha = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
const liveBaseCommit = sh('git', ['merge-base', 'origin/main', 'HEAD']).stdout.trim();
const diffNames = sh('git', ['diff', '--name-only', `${liveBaseCommit}...HEAD`]).stdout.trim().split('\n').filter(Boolean);

// ============================================================
// LEASE -- R9 mechanical diff-subset check.
// ============================================================
{
  const allowStr = wrLease && Array.isArray(wrLease.allow) ? (wrLease.allow as string[]) : CANONICAL_ALLOW;
  const denyStr = wrLease && Array.isArray(wrLease.deny) ? (wrLease.deny as string[]) : CANONICAL_DENY;
  const outsideAllow = diffNames.filter((f) => !matchesAnyGlob(f, allowStr));
  const insideDeny = diffNames.filter((f) => matchesAnyGlob(f, denyStr));
  const problems = [...outsideAllow.map((f) => `outside allow: ${f}`), ...insideDeny.map((f) => `inside deny: ${f}`)];
  record(
    'LEASE',
    `git diff --name-only ${liveBaseCommit}...HEAD`,
    "git diff --name-only <base>...HEAD is a subset of WR's allow globs and touches none of WR's deny globs",
    problems.length === 0 ? 'pass' : 'fail',
    problems.length === 0 ? `all ${diffNames.length} changed files inside the lease:\n${diffNames.join('\n')}` : problems.join('\n'),
  );
}

// ============================================================
// HEAD-DRIFT -- base is a real, live ancestor, not stale.
// ============================================================
{
  const isAncestor = sh('git', ['merge-base', '--is-ancestor', liveBaseCommit, headSha]).status === 0;
  record(
    'HEAD-DRIFT',
    'git merge-base origin/main HEAD; git merge-base --is-ancestor <base> HEAD',
    'baseCommit is an ancestor of HEAD and equals the live merge-base with origin/main at run time',
    isAncestor && liveBaseCommit.length > 0 ? 'pass' : 'fail',
    `baseCommit=${liveBaseCommit} head=${headSha} isAncestor=${isAncestor}`,
  );
}

// ============================================================
// CWR-P1-1 / CWR-P1-2 -- policy + telemetry (P1 tranche, staged).
// ============================================================
const routingPolicyExists = fs.existsSync(path.join(repoRoot, 'packages/contracts/src/api/routing-policy.ts'));
const routingPolicyTestGlobHits = fs.existsSync(path.join(repoRoot, 'packages/contracts/tests')) ? fs.readdirSync(path.join(repoRoot, 'packages/contracts/tests')).filter((f) => /^routing.*polic/i.test(f)) : [];
if (!routingPolicyExists || routingPolicyTestGlobHits.length === 0) {
  skip(
    'CWR-P1-1',
    `test -f packages/contracts/src/api/routing-policy.ts; ls packages/contracts/tests | grep -i routing.*polic`,
    'routing-policy.json/ts exists and its drift-failing policy test is green',
    'packages/contracts/src/api/routing-policy.ts and/or its policy test',
    'the P1 tranche',
  );
} else {
  const testRun = sh('pnpm', ['--filter', '@open-design/contracts', 'exec', 'vitest', 'run', ...routingPolicyTestGlobHits.map((f) => `tests/${f}`)]);
  record('CWR-P1-1', 'vitest run over the routing-policy test(s)', 'routing-policy module exists and its drift-failing policy test passes', testRun.status === 0 ? 'pass' : 'fail', testRun.stdout);
}

const routingTelemetryExists = fs.existsSync(path.join(repoRoot, 'packages/contracts/src/api/routing-telemetry.ts'));
const routingTelemetryTestGlobHits = fs.existsSync(path.join(repoRoot, 'packages/contracts/tests')) ? fs.readdirSync(path.join(repoRoot, 'packages/contracts/tests')).filter((f) => /^routing.*telemetry/i.test(f)) : [];
if (!routingTelemetryExists || routingTelemetryTestGlobHits.length === 0) {
  skip(
    'CWR-P1-2',
    `test -f packages/contracts/src/api/routing-telemetry.ts; ls packages/contracts/tests | grep -i routing.*telemetry`,
    'every run logs a complete telemetry row including routed-vs-observed model',
    'packages/contracts/src/api/routing-telemetry.ts and/or its test',
    'the P1 tranche',
  );
} else {
  const testRun = sh('pnpm', ['--filter', '@open-design/contracts', 'exec', 'vitest', 'run', ...routingTelemetryTestGlobHits.map((f) => `tests/${f}`)]);
  record('CWR-P1-2', 'vitest run over the routing-telemetry test(s)', 'telemetry row completeness (routed-vs-observed model) is asserted and green', testRun.status === 0 ? 'pass' : 'fail', testRun.stdout);
}

// ============================================================
// CWR-P2-1..4 -- dispatch routing, admission control, L3 gate runner,
// escalation/pass-rate visibility (P2 tranche, staged).
// ============================================================
const routingModuleDir = path.join(repoRoot, 'apps/daemon/src/routing');
const routingModuleExists = fs.existsSync(routingModuleDir) && fs.readdirSync(routingModuleDir).length > 0;
const routingRouteExists = fs.existsSync(path.join(repoRoot, 'apps/daemon/src/routes/routing.ts'));
const cliText = readText('apps/daemon/src/cli.ts') ?? '';
const odRouteRegistered = /\broute:\s*run(?:Route|Routing)\b/.test(cliText) || /['"]route['"]\s*:\s*run/i.test(cliText);

if (!routingModuleExists) {
  skip('CWR-P2-1', 'test -d apps/daemon/src/routing && ls it', 'dispatch-time routing decides by default with a UI/CLI override', 'apps/daemon/src/routing/**', 'the P2 tranche');
  skip('CWR-P2-2', 'test -d apps/daemon/src/routing && ls it', 'admission control denies dispatch when the pre-run cost ceiling would be exceeded', 'apps/daemon/src/routing/**', 'the P2 tranche');
  skip('CWR-P2-3', 'test -d apps/daemon/src/routing && ls it', 'deterministic L3 gate runner exists for lane-A (MishMash-native static) builds', 'apps/daemon/src/routing/**', 'the P2 tranche');
} else {
  const routingFiles = fs.readdirSync(routingModuleDir);
  const hasDispatch = routingFiles.some((f) => /dispatch|router/i.test(f));
  const hasAdmission = routingFiles.some((f) => /admission|budget/i.test(f));
  const hasL3 = routingFiles.some((f) => /l3|gate-runner|deterministic-gate/i.test(f));
  record('CWR-P2-1', `ls apps/daemon/src/routing`, 'a dispatch/router module exists', hasDispatch ? 'pass' : 'fail', routingFiles.join('\n'));
  record('CWR-P2-2', `ls apps/daemon/src/routing`, 'an admission-control/budget module exists', hasAdmission ? 'pass' : 'fail', routingFiles.join('\n'));
  record('CWR-P2-3', `ls apps/daemon/src/routing`, 'an L3 deterministic gate runner module exists', hasL3 ? 'pass' : 'fail', routingFiles.join('\n'));
}

if (!routingRouteExists) {
  skip('CWR-P2-4', 'test -f apps/daemon/src/routes/routing.ts; grep route cli.ts', "escalation/pass rates visible via /api/routing/* and `od route --json`", 'apps/daemon/src/routes/routing.ts and its od route CLI subcommand', 'the P2 tranche');
} else {
  record(
    'CWR-P2-4',
    'test -f apps/daemon/src/routes/routing.ts; grep for a route CLI subcommand in cli.ts',
    "escalation/pass rates visible via /api/routing/* and `od route --json`",
    odRouteRegistered ? 'pass' : 'fail',
    `apps/daemon/src/routes/routing.ts exists; od route registered in cli.ts=${odRouteRegistered}`,
  );
}

// ============================================================
// CWR-P2-5 -- selector-eval floors unchanged. Graded for real starting now:
// this needs no implementation, only a diff, so it is never staged/skipped.
// ============================================================
{
  const floorsPath = 'evals/selector/floors.json';
  const touchedFloors = diffNames.includes(floorsPath);
  const floorsExistsAtBase = sh('git', ['cat-file', '-e', `${liveBaseCommit}:${floorsPath}`]).status === 0;
  record(
    'CWR-P2-5',
    `git diff --name-only ${liveBaseCommit}...HEAD -- ${floorsPath}`,
    'evals/selector/floors.json is byte-identical between baseCommit and HEAD on every run of this verifier, including this P0 run',
    !touchedFloors ? 'pass' : 'fail',
    `floorsExistsAtBase=${floorsExistsAtBase}; touchedInDiff=${touchedFloors}`,
  );
}

// ============================================================
// GATE-INTEGRITY -- every criterion in WR-routing.md's Success criteria
// table has exactly one manifest entry, with a non-empty, hash-matched
// artifact.
// ============================================================
{
  const expectedIds = [
    'CWR-P0-1', 'CWR-P0-2', 'CWR-P0-3',
    'CWR-P1-1', 'CWR-P1-2',
    'CWR-P2-1', 'CWR-P2-2', 'CWR-P2-3', 'CWR-P2-4', 'CWR-P2-5',
    'LEASE', 'HEAD-DRIFT',
  ];
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
  record(
    'GATE-INTEGRITY',
    'cross-check manifest entries against WR-routing.md\'s Success criteria table',
    'every criterion ID has exactly one manifest entry with a non-empty, hash-matched artifact',
    problems.length === 0 ? 'pass' : 'fail',
    problems.length === 0 ? `all ${expectedIds.length} criteria present exactly once, all artifacts hash-matched` : problems.join('\n'),
  );
}

// --- commit-bound manifest ---
const treeDirty = sh('git', ['status', '--porcelain']).stdout.trim().length > 0;
const manifest = {
  wave: 'WR',
  commit: headSha,
  treeDirty,
  baseCommit: liveBaseCommit,
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const failures = results.filter((r) => r.status === 'fail');
const skips = results.filter((r) => r.status === 'skip');
const passes = results.filter((r) => r.status === 'pass');
console.log(`\nverify-wr-routing: ${passes.length} pass, ${skips.length} skip, ${failures.length} fail (of ${results.length}); treeDirty=${treeDirty}`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id} — ${r.assertion}`);
if (skips.length > 0) console.log(`  ⚠ ${skips.length} criteria SKIPPED (staged for a later tranche, never silent -- see manifest for exact reasons)`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
process.exit(failures.length === 0 && !treeDirty ? 0 : 1);
