/**
 * Canvas/Workbench coverage gate.
 *
 * Reads `docs/canvas-feature-inventory.json` and asserts that every catalogued
 * canvas capability names at least one proving test, and that each named test
 * actually exists on disk.
 *
 * A feature list is only useful if it cannot quietly drift from the tests. Two
 * drifts are possible and both are failures here: a feature that names no test
 * (nothing proves it) and a feature that names a test that has since been
 * renamed or deleted (something *used* to prove it, and the list still claims
 * it does).
 *
 *   pnpm exec tsx scripts/canvas-coverage-report.ts            # report + gate
 *   pnpm exec tsx scripts/canvas-coverage-report.ts --json     # machine output
 *   pnpm exec tsx scripts/canvas-coverage-report.ts --group X  # one group
 *
 * Exit 0 when every feature is covered and every named test exists; exit 1
 * otherwise, listing exactly what is missing.
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
   * Set only for entries that record a documented ABSENCE rather than a
   * capability — there is no code path to test, so demanding a test would force
   * either a fake proof or a permanently red gate. The value is the
   * justification and is required: an unexplained exemption is how a real gap
   * gets quietly excused.
   */
  not_applicable?: string;
};

type Inventory = { features: Feature[] };

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const groupIndex = args.indexOf('--group');
const groupFilter = groupIndex === -1 ? null : args[groupIndex + 1];

if (!existsSync(inventoryPath)) {
  process.stderr.write(`missing inventory: ${inventoryPath}\n`);
  process.exit(1);
}

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
const features = groupFilter
  ? inventory.features.filter((feature) => feature.group === groupFilter)
  : inventory.features;

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

const uncovered: Feature[] = [];
const dangling: { feature: Feature; missing: string[] }[] = [];
const covered: Feature[] = [];
const exempt: Feature[] = [];

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
  if (missing.length > 0) dangling.push({ feature, missing });
  else covered.push(feature);
}

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        total: features.length,
        covered: covered.length,
        uncovered: uncovered.map((feature) => feature.id),
        dangling: dangling.map((entry) => ({ id: entry.feature.id, missing: entry.missing })),
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

  if (exempt.length > 0) {
    process.stdout.write(`\nNOT APPLICABLE — documented absence, no code path to test (${exempt.length}):\n`);
    for (const feature of exempt) {
      process.stdout.write(`  ${feature.id}\n      ${feature.not_applicable}\n`);
    }
  }

  process.stdout.write(`\nUNCOVERED ${uncovered.length}\n`);
  process.stdout.write(`DANGLING ${dangling.length}\n`);
  process.stdout.write(`EXEMPT ${exempt.length}\n`);
  process.stdout.write(`COVERED ${covered.length}/${features.length - exempt.length}\n`);
}

process.exit(uncovered.length === 0 && dangling.length === 0 ? 0 : 1);
