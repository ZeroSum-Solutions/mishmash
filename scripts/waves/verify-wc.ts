// verify-wc.ts -- wave W-C (web-clone close-out) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-wc.ts
// Exit 0 only when every CC criterion passes; the commit-bound proof
// manifest is written to the wave's goal-state proof directory either way.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const proofDir = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-wc-clone-closeout', 'proof');
fs.mkdirSync(proofDir, { recursive: true });

const WEB_CLONE_TEST_FILES = [
  'tests/web-clone-bot-wall-detection.test.ts',
  'tests/web-clone-mirror-asset-discovery.test.ts',
  'tests/web-clone-mirror-manifest.test.ts',
  'tests/web-clone-mirror-site-capture.test.ts',
  'tests/web-clone-verify-mirror-gate.test.ts',
  'tests/web-clone-verify-mirror-server.test.ts',
  'tests/web-clone-marquee-overflow-clamp.test.ts',
  'tests/web-clone-skill-ref.test.ts',
  'tests/project-create-web-clone-discovery.test.ts',
];

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
  status: 'pass' | 'fail';
  detail?: string | undefined;
}

function artifactFor(id: string, content: string): { artifact: string; artifactSha256: string } {
  const file = path.join(proofDir, `${id}.txt`);
  fs.writeFileSync(file, content);
  return { artifact: file, artifactSha256: crypto.createHash('sha256').update(content).digest('hex') };
}

const results: CriterionResult[] = [];
function record(id: string, command: string, assertion: string, ok: boolean, evidence: string, detail?: string): void {
  const { artifact, artifactSha256 } = artifactFor(id, `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n\n${evidence}\n`);
  results.push({ id, command, assertion, artifact, artifactSha256, exitCode: ok ? 0 : 1, status: ok ? 'pass' : 'fail', detail });
}

// --- one full suite run, JSON reporter, evaluated per-criterion below ---
const suiteJsonPath = path.join(proofDir, 'suite-run.json');
const suite = sh('pnpm', ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${suiteJsonPath}`, ...WEB_CLONE_TEST_FILES]);
interface AssertionResult { fullName: string; status: string }
interface SuiteJson { numFailedTests: number; numPassedTests: number; testResults: { assertionResults: AssertionResult[] }[] }
let suiteData: SuiteJson | null = null;
try {
  suiteData = JSON.parse(fs.readFileSync(suiteJsonPath, 'utf8')) as SuiteJson;
} catch {
  suiteData = null;
}
const allTests: AssertionResult[] = suiteData ? suiteData.testResults.flatMap((t) => t.assertionResults) : [];
const passedNames = new Set(allTests.filter((t) => t.status === 'passed').map((t) => t.fullName));
function passedMatching(needle: string): string[] {
  return [...passedNames].filter((n) => n.includes(needle));
}
function failedOrMissing(needle: string, minimum: number): { ok: boolean; evidence: string } {
  const hits = allTests.filter((t) => t.fullName.includes(needle));
  const passed = hits.filter((t) => t.status === 'passed');
  const ok = passed.length >= minimum && hits.every((t) => t.status === 'passed');
  return {
    ok,
    evidence: hits.length
      ? hits.map((t) => `${t.status.toUpperCase()}  ${t.fullName}`).join('\n')
      : `NO TESTS MATCHED "${needle}" (skipped-by-environment counts as missing evidence, not a pass)`,
  };
}

// CC-1: the seven-item assertion matrix, red transcript + green tests per item.
const redTranscript = path.join(proofDir, 'CC-1-red.txt');
const redContent = fs.existsSync(redTranscript) ? fs.readFileSync(redTranscript, 'utf8') : '';
const matrix = [
  { item: 'A1', needle: '(A1/CC-2)', min: 1 },
  { item: 'A2', needle: '(A2', min: 4 },
  { item: 'A3', needle: '(A3', min: 4 },
  { item: 'A4', needle: '(A4', min: 3 },
  { item: 'A5', needle: '(A5', min: 2 },
  { item: 'A6', needle: '(A6', min: 3 },
  { item: 'A7', needle: '(A7', min: 6 },
] as const;
const matrixRows = matrix.map(({ item, needle, min }) => {
  const green = failedOrMissing(needle, min);
  const redMentioned = redContent.includes(`${item}`) && redContent.includes('RED');
  return { item, greenOk: green.ok, redMentioned, evidence: green.evidence };
});
record(
  'CC-1',
  'red transcript + per-item green assertions',
  'all 7 class-A items: red observed on parent 371daca15, green at head',
  matrixRows.every((r) => r.greenOk && r.redMentioned) && redContent.length > 0,
  matrixRows.map((r) => `${r.item}: red-recorded=${r.redMentioned} green=${r.greenOk}\n${r.evidence}`).join('\n\n'),
);

for (const [id, needle, min, assertion] of [
  ['CC-2', '(A1/CC-2)', 1, 'no-progress exhaustion exits non-zero (real subprocess)'],
  ['CC-3', 'A2/CC-3', 2, 'origin leak detected independent of response status (pure + wire)'],
  ['CC-4', 'A2/CC-4', 2, 'negative control: unrelated offline CDN does not trip the leak gate'],
  ['CC-5', '(A3', 4, 'malformed baseline fails closed with named diagnostics'],
  ['CC-6', '(A7', 6, 'URL-attribute coverage table-driven (data/imagesrcset/action/formaction/xlink:href/unquoted srcset)'],
] as const) {
  const check = failedOrMissing(needle, min);
  record(id, `vitest tests matching "${needle}"`, assertion, check.ok, check.evidence);
}

// CC-7: no unenforced-guarantee claims in the touched scripts; the claims
// list is explicit so this stays mechanical, not a reviewer vibe-check.
const forbiddenClaims: [string, RegExp][] = [
  ['unqualified injectivity claim', /\bit is injective\b|\binjective:\s/i],
  ['unquoted-srcset impossibility claim', /cannot occur validly/i],
  ['failed-request-cannot-leak claim', /failed request can't itself be a "leak"/i],
];
const scriptFiles: string[] = [];
for (const dir of ['skills/web-clone/scripts', 'skills/web-clone/scripts/lib']) {
  for (const f of fs.readdirSync(path.join(repoRoot, dir))) {
    if (f.endsWith('.mjs')) scriptFiles.push(path.join(repoRoot, dir, f));
  }
}
const claimHits: string[] = [];
for (const file of scriptFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of forbiddenClaims) {
    if (pattern.test(text)) claimHits.push(`${path.relative(repoRoot, file)}: ${label}`);
  }
}
record('CC-7', 'claims-list grep over skills/web-clone/scripts/**', 'zero unenforced-guarantee claims remain', claimHits.length === 0, claimHits.join('\n') || 'no forbidden claim patterns matched');

// CC-8: class-B limitations documented, list frozen at exactly 3 items.
const skillMd = fs.readFileSync(path.join(repoRoot, 'skills/web-clone/SKILL.md'), 'utf8');
const limitationsSection = skillMd.split('## Known limitations')[1]?.split('\n## ')[0] ?? '';
const classBMarkers = ['symlink', 'claim()', 'url-manifest.json'];
const numberedItems = limitationsSection.match(/^\d+\.\s/gm) ?? [];
record(
  'CC-8',
  'SKILL.md "Known limitations" section inspection',
  'exactly the 3 frozen class-B items, each with a precondition',
  classBMarkers.every((m) => limitationsSection.includes(m)) && numberedItems.length === 3 && /[Pp]recondition/.test(limitationsSection),
  `numbered items: ${numberedItems.length}; markers present: ${classBMarkers.map((m) => `${m}=${limitationsSection.includes(m)}`).join(', ')}`,
);

// CC-9: full suite green, zero banned skip/only/todo markers, repo gates.
const bannedMarker = /\b(?:it|describe|test)\.(?:skip|only|todo)\(/; // describe.skipIf (env gate) is the pre-existing convention and stays legal
const markerHits: string[] = [];
for (const rel of WEB_CLONE_TEST_FILES) {
  const text = fs.readFileSync(path.join(repoRoot, 'apps/daemon', rel), 'utf8');
  if (bannedMarker.test(text)) markerHits.push(rel);
}
const guard = sh('pnpm', ['guard']);
const typecheck = sh('pnpm', ['typecheck']);
record(
  'CC-9',
  'vitest full web-clone suite + marker grep + pnpm guard + pnpm typecheck',
  'suite green, no skip/only/todo, guard exit 0, typecheck exit 0',
  suite.status === 0 && (suiteData?.numFailedTests ?? 1) === 0 && markerHits.length === 0 && guard.status === 0 && typecheck.status === 0,
  `suite exit=${suite.status} failed=${suiteData?.numFailedTests ?? 'unknown'} passed=${suiteData?.numPassedTests ?? 'unknown'}\nbanned markers: ${markerHits.join(', ') || 'none'}\nguard exit=${guard.status}\ntypecheck exit=${typecheck.status}`,
);

// CC-10: every baseline test (the previously-confirmed fixes) still present and green.
const baselineInventoryPath = path.join(proofDir, 'CC-10-baseline.txt');
const baselineRaw = fs.existsSync(baselineInventoryPath) ? fs.readFileSync(baselineInventoryPath, 'utf8') : '';
const baselineTitles = baselineRaw
  .split('\n')
  .filter((line) => line.includes(' > '))
  .map((line) => line.split(' > ').slice(1).join(' ').trim())
  .filter(Boolean);
const currentTitleBlob = [...passedNames].join('\n');
const missingBaseline = baselineTitles.filter((title) => !currentTitleBlob.includes(title.split(' > ').pop() ?? title));
record(
  'CC-10',
  'baseline inventory (112 names) vs current green run',
  'every previously-confirmed test still present and passing',
  baselineTitles.length >= 100 && missingBaseline.length === 0,
  `baseline titles: ${baselineTitles.length}; missing from current green run: ${missingBaseline.length}\n${missingBaseline.slice(0, 20).join('\n')}`,
);

// CC-11: landed. W0 precondition founder-waived 2026-07-26 (recorded in the
// wave run log); the mechanical remainder is: branch merged into origin/main.
const headSha = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
const merged = sh('git', ['merge-base', '--is-ancestor', headSha, 'origin/main']);
record('CC-11', 'git merge-base --is-ancestor HEAD origin/main', 'branch merged (W0 precondition founder-waived)', merged.status === 0, `HEAD=${headSha} merged=${merged.status === 0}`);

// R9 lease check: the branch diff must stay inside W-C's leases.json globs.
const diffNames = sh('git', ['diff', '--name-only', 'origin/main...HEAD']).stdout.trim().split('\n').filter(Boolean);
const leaseViolations = diffNames.filter(
  (f) =>
    !f.startsWith('skills/web-clone/') &&
    !/^apps\/daemon\/tests\/(web-clone-[^/]+|project-create-web-clone-discovery)\.test\.ts$/.test(f) &&
    f !== 'scripts/waves/verify-wc.ts' &&
    !f.startsWith('docs/plans/waves/'),
);
record('LEASE', 'git diff --name-only origin/main...HEAD ⊆ leases.json[W-C].allow', 'no writes outside the W-C lease', leaseViolations.length === 0, leaseViolations.join('\n') || `all ${diffNames.length} changed files inside the lease`);

// --- commit-bound manifest ---
const treeDirty = sh('git', ['status', '--porcelain']).stdout.trim().length > 0;
const manifest = {
  wave: 'W-C',
  commit: headSha,
  treeDirty,
  baseCommit: sh('git', ['merge-base', 'origin/main', 'HEAD']).stdout.trim(),
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  criteria: results,
};
fs.writeFileSync(path.join(proofDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const failures = results.filter((r) => r.status === 'fail');
console.log(`\nverify-wc: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty})`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id} — ${r.assertion}`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT §2)');
process.exit(failures.length === 0 && !treeDirty ? 0 : 1);
