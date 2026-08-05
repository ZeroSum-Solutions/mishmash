// Coverage guard for the design-catalogue visual baseline lane
// (pairs with the screenshot lane in e2e/ui/visual-catalog.test.ts).
//
// The screenshot lane generates one test per discovered fixture. If
// discovery ever returned nothing — a renamed directory, a moved fixture
// filename, a bad path resolution — the lane would report "0 failed" and
// look healthy while asserting nothing at all. That failure mode is silent
// and total, so the inventory gets its own check here rather than inside
// the Playwright lane it is supposed to be guarding.
//
// This lives in `e2e/tests/` because it is a repository-resource
// consistency check over two top-level content directories, not UI
// automation — and because it needs no browser and no daemon.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  catalogTargetUrl,
  discoverCatalogTargets,
  selectCatalogShard,
} from '../lib/playwright/catalog.js';
import { CATALOG_COVERAGE_PIN } from '../resources/catalog-coverage-pin.js';

// Floors, not exact counts: the catalogue grows, and a test that has to be
// edited every time someone adds a design system would be edited without
// being read. These numbers only need to catch discovery collapsing.
const MIN_DESIGN_SYSTEMS = 100;
const MIN_DESIGN_TEMPLATES = 50;

describe('design catalogue visual coverage', () => {
  const targets = discoverCatalogTargets();

  it('discovers the design-system component fixtures', () => {
    const systems = targets.filter((t) => t.kind === 'design-system');
    expect(systems.length).toBeGreaterThanOrEqual(MIN_DESIGN_SYSTEMS);
  });

  it('discovers the design-template examples', () => {
    const templates = targets.filter((t) => t.kind === 'design-template');
    expect(templates.length).toBeGreaterThanOrEqual(MIN_DESIGN_TEMPLATES);
  });

  it('points every target at a file that exists', () => {
    for (const target of targets) {
      expect(existsSync(target.file), `${target.kind}/${target.id}`).toBe(true);
      expect(path.isAbsolute(target.file)).toBe(true);
    }
  });

  it('gives every target a unique baseline name', () => {
    // Two fixtures sharing a snapshot name would silently overwrite one
    // baseline, and the loser would then be compared against the winner's
    // pixels forever.
    const names = targets.map((t) => t.snapshot);
    expect(new Set(names).size).toBe(names.length);
  });

  it('builds file: urls the browser can load', () => {
    for (const target of targets.slice(0, 5)) {
      expect(catalogTargetUrl(target).startsWith('file://')).toBe(true);
    }
  });
});

describe('catalog coverage pin', () => {
  // The floors above only catch discovery collapsing wholesale. A single
  // fixture deletion (e.g. `design-templates/saas-landing/example.html`
  // removed) still clears both floors and discoverCatalogTargets() skips a
  // missing fixture silently by design (see catalog.ts), so that loss is
  // invisible to every other check in this file. This pin is a committed
  // snapshot of catalogue ids known to ship a fixture; it is a floor, not an
  // exact-match lock, so discovering something new is never a failure here.
  const targets = discoverCatalogTargets();
  const discoveredIds = new Set(targets.map((t) => `${t.kind}/${t.id}`));

  it('still discovers every pinned fixture', () => {
    const missing = CATALOG_COVERAGE_PIN.filter(
      (entry) => !discoveredIds.has(`${entry.kind}/${entry.id}`),
    );
    expect(
      missing,
      `pinned fixture(s) no longer discovered: ${missing
        .map((entry) => `${entry.kind}/${entry.id}`)
        .join(', ')}`,
    ).toEqual([]);
  });
});

describe('selectCatalogShard', () => {
  const targets = discoverCatalogTargets();

  it('returns everything when no shard is configured', () => {
    expect(selectCatalogShard(targets, {}).length).toBe(targets.length);
  });

  it('partitions the catalogue exactly once across all shards', () => {
    // The property that matters: no fixture is skipped and none is shot
    // twice. Sharding is the easiest place to silently lose coverage.
    const shards = 7;
    const seen: string[] = [];
    for (let i = 1; i <= shards; i += 1) {
      const slice = selectCatalogShard(targets, {
        OD_VISUAL_CATALOG_SHARDS: String(shards),
        OD_VISUAL_CATALOG_SHARD: String(i),
      });
      seen.push(...slice.map((t) => t.snapshot));
    }
    expect(seen.length).toBe(targets.length);
    expect(new Set(seen).size).toBe(targets.length);
  });

  it('spreads both catalogues across every shard', () => {
    // Striding rather than slicing keeps slow deck templates from all
    // landing in one shard while another finishes in seconds.
    const shards = 4;
    for (let i = 1; i <= shards; i += 1) {
      const slice = selectCatalogShard(targets, {
        OD_VISUAL_CATALOG_SHARDS: String(shards),
        OD_VISUAL_CATALOG_SHARD: String(i),
      });
      expect(slice.some((t) => t.kind === 'design-system')).toBe(true);
      expect(slice.some((t) => t.kind === 'design-template')).toBe(true);
    }
  });

  it('rejects an out-of-range shard index instead of running nothing', () => {
    // Silently returning an empty slice for shard 9 of 4 would make a
    // misconfigured CI matrix look green.
    expect(() =>
      selectCatalogShard(targets, {
        OD_VISUAL_CATALOG_SHARDS: '4',
        OD_VISUAL_CATALOG_SHARD: '9',
      }),
    ).toThrow(/between 1 and 4/);
  });
});
