// Roster regression for the Workflows and Assets curation (2026-07-30):
// the bundled catalog renders exactly the 90 curated tiles. Flow plugins
// (od-* scenarios, the share actions, the home-hero clone/deck entries)
// and atoms stay installed but never appear as tiles. Uses the same
// visibility predicate as the gallery hook so the contract cannot drift
// from the implementation.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGalleryVisiblePlugin } from '../../src/components/plugins-home/galleryVisibility';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BUNDLED_ROOT = path.join(REPO_ROOT, 'plugins', '_official');

interface BundledManifest {
  name?: string;
  od?: { kind?: string };
  tags?: string[];
}

function bundledManifests(): BundledManifest[] {
  const manifests: BundledManifest[] = [];
  for (const tier of readdirSync(BUNDLED_ROOT, { withFileTypes: true })) {
    if (!tier.isDirectory()) continue;
    for (const entry of readdirSync(path.join(BUNDLED_ROOT, tier.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(BUNDLED_ROOT, tier.name, entry.name, 'open-design.json');
      let text: string;
      try {
        text = readFileSync(manifestPath, 'utf8');
      } catch {
        continue; // asset folder without a manifest
      }
      manifests.push(JSON.parse(text) as BundledManifest);
    }
  }
  return manifests;
}

describe('bundled gallery roster', () => {
  it('renders exactly the 90 curated bundled tiles and hides every flow plugin', () => {
    const manifests = bundledManifests();
    // Full bundled tree: 90 curated tiles + 13 atoms + 17 hidden flow
    // plugins (12 od-* flows, 2 share actions, web-clone, simple-deck,
    // od-share-to-community lives among the 13 scenarios tier entries).
    expect(manifests.length).toBe(120);

    const visible = manifests.filter((manifest) => isGalleryVisiblePlugin({ manifest }));
    expect(visible.length).toBe(90);

    const visibleNames = new Set(visible.map((manifest) => manifest.name));
    for (const flowId of [
      'od-plugin-publish-github',
      'od-plugin-contribute-open-design',
      'example-simple-deck',
      'example-web-clone',
      'od-new-generation',
      'od-share-to-community',
      'od-default',
    ]) {
      expect(visibleNames.has(flowId), `${flowId} must stay hidden from the gallery`).toBe(false);
    }
  });
});
