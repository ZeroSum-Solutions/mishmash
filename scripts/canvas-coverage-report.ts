/**
 * Canvas/Workbench coverage gate.
 *
 * Reads `docs/canvas-feature-inventory.json` and asserts that every catalogued
 * canvas capability names at least one proving test, that each named test
 * actually exists on disk, and — for high-risk capabilities — that the named
 * proof is not purely presentational.
 *
 * A feature list is only useful if it cannot quietly drift from the tests. Three
 * drifts are possible and all are failures here:
 *
 *   1. a feature that names no test (nothing proves it);
 *   2. a feature that names a test that has since been renamed or deleted
 *      (something *used* to prove it, and the list still claims it does);
 *   3. a HIGH-RISK feature whose only named proof is presentational.
 *
 * (3) exists because of a real miss. `screenshot-copy` was reported COVERED
 * while screenshot capture was broken in every browser: its only proof was a
 * test asserting the button's tooltip text. The tooltip was perfect. Nothing
 * ever called the capture. A file-exists check cannot tell those apart, so
 * high-risk entries additionally have to name a test outside the presentational
 * set and state, in `proof_note`, what that test actually asserts.
 *
 * The note is an author's claim, not a machine-checked fact — its value is that
 * it is explicit and reviewable, where a bare file path let the claim stay
 * implied. `COVERED` here therefore means "named, existing, and not
 * presentational-only", never "behaviour verified".
 *
 *   pnpm exec tsx scripts/canvas-coverage-report.ts            # report + gate
 *   pnpm exec tsx scripts/canvas-coverage-report.ts --json     # machine output
 *   pnpm exec tsx scripts/canvas-coverage-report.ts --group X  # one group
 *
 * Also runs inside `pnpm guard`, so the inventory cannot drift between the
 * occasional manual runs that let the miss above survive as long as it did.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(repoRoot, 'docs', 'canvas-feature-inventory.json');

type Feature = {
  id: string;
  group: string;
  name: string;
  risk: 'high' | 'medium' | 'low';
  verifiable_by: 'unit' | 'e2e' | 'static' | 'manual-browser';
  source_files: string[];
  proof_tests: string[];
  /**
   * Required for `risk: high`. One sentence naming the behaviour the proof
   * tests assert — not what the feature does. "Asserts the tooltip label" is a
   * legitimate note; it just is not enough on its own to carry a high-risk row.
   */
  proof_note?: string;
  /**
   * Set only for entries that record a documented ABSENCE rather than a
   * capability — there is no code path to test, so demanding a test would force
   * either a fake proof or a permanently red gate. The value is the
   * justification and is required: an unexplained exemption is how a real gap
   * gets quietly excused.
   */
  not_applicable?: string;
};

type Inventory = { features: Feature[] };

/**
 * Test paths whose subject is appearance, not behaviour. A high-risk capability
 * may cite these — they are real tests — but not ONLY these.
 */
const PRESENTATIONAL_TEST_PATTERNS = [
  /(^|\/)tests\/styles\//,
  /tooltip/i,
  /\.styles\./,
  /-styles\./,
  /\.css\./,
];

function isPresentationalTest(candidate: string): boolean {
  return PRESENTATIONAL_TEST_PATTERNS.some((pattern) => pattern.test(candidate));
}

/**
 * Resolves a recorded test path against the repo.
 *
 * Paths in the inventory are written the way a human cites them, which is
 * sometimes repo-relative and sometimes relative to the owning package. Both
 * are accepted so that a correct entry is never reported as missing over a
 * formatting difference.
 */
function resolveTestPath(candidate: string): string | null {
  const prefixes = ['', 'apps/web/', 'apps/daemon/', 'e2e/', 'packages/contracts/'];
  for (const prefix of prefixes) {
    const full = path.join(repoRoot, prefix + candidate);
    if (existsSync(full)) return path.relative(repoRoot, full);
  }
  return null;
}

export interface CanvasCoverageResult {
  features: Feature[];
  covered: Feature[];
  uncovered: Feature[];
  exempt: Feature[];
  dangling: { feature: Feature; missing: string[] }[];
  /** High-risk rows whose only surviving proof is presentational, or which do
   * not say what their proof asserts. */
  weakHighRisk: { feature: Feature; reason: string }[];
}

export function evaluateCanvasCoverage(groupFilter?: string | null): CanvasCoverageResult {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
  const features = groupFilter
    ? inventory.features.filter((feature) => feature.group === groupFilter)
    : inventory.features;

  const uncovered: Feature[] = [];
  const dangling: { feature: Feature; missing: string[] }[] = [];
  const covered: Feature[] = [];
  const exempt: Feature[] = [];
  const weakHighRisk: { feature: Feature; reason: string }[] = [];

  for (const feature of features) {
    if (feature.not_applicable) {
      exempt.push(feature);
      continue;
    }
    if (feature.proof_tests.length === 0) {
      uncovered.push(feature);
      continue;
    }
    const missing = feature.proof_tests.filter((candidate) => resolveTestPath(candidate) === null);
    if (missing.length > 0) {
      dangling.push({ feature, missing });
      continue;
    }
    if (feature.risk === 'high') {
      const behavioural = feature.proof_tests.filter((candidate) => !isPresentationalTest(candidate));
      if (behavioural.length === 0) {
        weakHighRisk.push({
          feature,
          reason: 'every named proof is presentational (tooltip / styles); name a test that exercises the capability',
        });
        continue;
      }
      if (!feature.proof_note || feature.proof_note.trim().length === 0) {
        weakHighRisk.push({
          feature,
          reason: 'high-risk rows must state in proof_note what their tests assert',
        });
        continue;
      }
    }
    covered.push(feature);
  }

  return { features, covered, uncovered, exempt, dangling, weakHighRisk };
}

/** Guard entry point (`pnpm guard`). Prints only on failure. */
export async function checkCanvasCoverage(): Promise<boolean> {
  if (!existsSync(inventoryPath)) {
    console.error(`Canvas coverage: missing inventory ${path.relative(repoRoot, inventoryPath)}`);
    return false;
  }
  const result = evaluateCanvasCoverage(null);
  const problems: string[] = [
    ...result.uncovered.map((f) => `${f.id}: names no proving test`),
    ...result.dangling.map((d) => `${d.feature.id}: names missing test(s) ${d.missing.join(', ')}`),
    ...result.weakHighRisk.map((w) => `${w.feature.id}: ${w.reason}`),
  ];
  if (problems.length === 0) return true;
  console.error('Canvas/Workbench coverage gate failed:');
  for (const problem of problems) console.error(`  ${problem}`);
  return false;
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const groupIndex = args.indexOf('--group');
  const groupFilter = groupIndex === -1 ? null : args[groupIndex + 1];

  if (!existsSync(inventoryPath)) {
    process.stderr.write(`missing inventory: ${inventoryPath}\n`);
    process.exit(1);
  }

  const { features, covered, uncovered, dangling, exempt, weakHighRisk } =
    evaluateCanvasCoverage(groupFilter);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          total: features.length,
          covered: covered.length,
          uncovered: uncovered.map((feature) => feature.id),
          dangling: dangling.map((entry) => ({ id: entry.feature.id, missing: entry.missing })),
          weakHighRisk: weakHighRisk.map((entry) => ({ id: entry.feature.id, reason: entry.reason })),
          exempt: exempt.map((feature) => feature.id),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const byGroup = new Map<string, { total: number; covered: number }>();
    for (const feature of features) {
      if (feature.not_applicable) continue;
      const bucket = byGroup.get(feature.group) ?? { total: 0, covered: 0 };
      bucket.total += 1;
      if (covered.includes(feature)) bucket.covered += 1;
      byGroup.set(feature.group, bucket);
    }

    process.stdout.write('Canvas/Workbench coverage\n');
    process.stdout.write('(a named, existing, non-presentational test — not verified behaviour)\n');
    process.stdout.write('─'.repeat(58) + '\n');
    for (const [group, bucket] of [...byGroup.entries()].sort()) {
      const pct = Math.round((bucket.covered / bucket.total) * 100);
      process.stdout.write(
        `  ${group.padEnd(18)} ${String(bucket.covered).padStart(3)}/${String(bucket.total).padEnd(3)} ${String(pct).padStart(3)}%\n`,
      );
    }
    process.stdout.write('─'.repeat(58) + '\n');

    if (uncovered.length > 0) {
      process.stdout.write(`\nUNCOVERED — no test named (${uncovered.length}):\n`);
      for (const feature of uncovered) {
        process.stdout.write(`  [${feature.risk.padEnd(6)}] ${feature.id.padEnd(38)} ${feature.name}\n`);
      }
    }

    if (dangling.length > 0) {
      process.stdout.write(`\nDANGLING — named test does not exist (${dangling.length}):\n`);
      for (const entry of dangling) {
        process.stdout.write(`  ${entry.feature.id}\n`);
        for (const missing of entry.missing) process.stdout.write(`      missing: ${missing}\n`);
      }
    }

    if (weakHighRisk.length > 0) {
      process.stdout.write(`\nWEAK HIGH-RISK PROOF (${weakHighRisk.length}):\n`);
      for (const entry of weakHighRisk) {
        process.stdout.write(`  ${entry.feature.id}\n      ${entry.reason}\n`);
      }
    }

    if (exempt.length > 0) {
      process.stdout.write(`\nNOT APPLICABLE — documented absence, no code path to test (${exempt.length}):\n`);
      for (const feature of exempt) {
        process.stdout.write(`  ${feature.id}\n      ${feature.not_applicable}\n`);
      }
    }

    process.stdout.write(`\nUNCOVERED ${uncovered.length}\n`);
    process.stdout.write(`DANGLING ${dangling.length}\n`);
    process.stdout.write(`WEAK-HIGH-RISK ${weakHighRisk.length}\n`);
    process.stdout.write(`EXEMPT ${exempt.length}\n`);
    process.stdout.write(`COVERED ${covered.length}/${features.length - exempt.length}\n`);
  }

  process.exit(
    uncovered.length === 0 && dangling.length === 0 && weakHighRisk.length === 0 ? 0 : 1,
  );
}
