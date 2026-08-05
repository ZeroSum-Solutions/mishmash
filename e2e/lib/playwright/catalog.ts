// Discovery for the design-catalog visual baseline lane.
//
// The repository ships two statically renderable catalogues:
//
//   design-systems/<id>/components.html — a component fixture whose every
//     visible value comes from that system's `tokens.css`.
//   design-templates/<id>/example.html  — a rendered example of the template.
//
// Together they are the only part of the catalogue that can be rendered
// without an agent in the loop, which makes them the only part a
// deterministic regression lane can cover. Everything an agent composes at
// run time is out of scope here by construction.
//
// Kept out of `e2e/ui/` because that directory holds flat Playwright test
// files only (see `e2e/AGENTS.md`).

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export type CatalogKind = 'design-system' | 'design-template';

export interface CatalogTarget {
  kind: CatalogKind;
  /** Directory name — `linear-app`, `saas-landing`. */
  id: string;
  /** Absolute path to the renderable HTML fixture. */
  file: string;
  /** Stable baseline filename. */
  snapshot: string;
}

interface CatalogSource {
  kind: CatalogKind;
  dir: string;
  fixture: string;
}

const SOURCES: readonly CatalogSource[] = [
  { kind: 'design-system', dir: 'design-systems', fixture: 'components.html' },
  { kind: 'design-template', dir: 'design-templates', fixture: 'example.html' },
];

function listEntries(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Every catalogue entry that ships a renderable fixture.
 *
 * Entries without one are skipped silently: a design system that carries only
 * a `DESIGN.md` is a legitimate package shape, not a coverage gap.
 */
export function discoverCatalogTargets(): CatalogTarget[] {
  const targets: CatalogTarget[] = [];
  for (const source of SOURCES) {
    const absDir = path.join(repoRoot, source.dir);
    for (const id of listEntries(absDir)) {
      const file = path.join(absDir, id, source.fixture);
      if (!existsSync(file)) continue;
      targets.push({
        kind: source.kind,
        id,
        file,
        snapshot: `${source.kind}-${id}.png`,
      });
    }
  }
  return targets;
}

export function catalogTargetUrl(target: CatalogTarget): string {
  return pathToFileURL(target.file).href;
}

/**
 * Select this process's slice of the catalogue.
 *
 * 255 full-page screenshots is too much for one CI job, so the lane shards by
 * index with a deterministic stride: `OD_VISUAL_CATALOG_SHARD` is 1-based and
 * `OD_VISUAL_CATALOG_SHARDS` is the total. Striding rather than slicing keeps
 * the two catalogues mixed through every shard, so one shard is never all
 * decks (slow) while another is all colour swatches (fast).
 *
 * Unset means "run everything", which is what a local `--update-snapshots`
 * run wants.
 */
export function selectCatalogShard(
  targets: readonly CatalogTarget[],
  env: NodeJS.ProcessEnv = process.env,
): CatalogTarget[] {
  const total = Number(env.OD_VISUAL_CATALOG_SHARDS ?? '');
  const index = Number(env.OD_VISUAL_CATALOG_SHARD ?? '');
  if (!Number.isInteger(total) || total < 1) return [...targets];
  if (!Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(
      `OD_VISUAL_CATALOG_SHARD must be between 1 and ${total}, got: ${env.OD_VISUAL_CATALOG_SHARD}`,
    );
  }
  return targets.filter((_, i) => i % total === index - 1);
}
