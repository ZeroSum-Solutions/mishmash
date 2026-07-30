// Roster regression for the Workflows and Assets curation (2026-07-30):
// the bundled catalog renders exactly the 90 curated tiles. Flow plugins
// (od-* scenarios, the share actions, the home-hero clone/deck entries)
// and atoms stay installed but never appear as tiles. Uses the same
// visibility predicate as the gallery hook so the contract cannot drift
// from the implementation, and mirrors BOTH bundled layouts the daemon
// walker registers (a direct plugins/_official/<plugin>/open-design.json
// manifest folder, and the tiered plugins/_official/<tier>/<plugin>/
// layout — see apps/daemon/src/plugins/bundled.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGalleryVisiblePlugin } from '../../src/components/plugins-home/galleryVisibility';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BUNDLED_ROOT = path.join(REPO_ROOT, 'plugins', '_official');

// The complete curated gallery — Devin's 90-item keep list. Any bundled
// catalog change (add, retire, tag flip) must consciously update this pin.
const VISIBLE_ROSTER = [
  'design-system-airbnb',
  'design-system-apple',
  'design-system-cursor',
  'design-system-editorial',
  'design-system-ferrari',
  'design-system-glassmorphism',
  'design-system-kami',
  'design-system-lamborghini',
  'design-system-linear-app',
  'design-system-minimal',
  'design-system-mission-control',
  'design-system-neobrutalism',
  'design-system-nike',
  'design-system-notion',
  'design-system-raycast',
  'design-system-revolut',
  'design-system-shadcn',
  'design-system-shopify',
  'design-system-spacex',
  'design-system-spotify',
  'design-system-stripe',
  'design-system-tesla',
  'design-system-totality-festival',
  'design-system-uber',
  'design-system-vercel',
  'example-blog-post',
  'example-dashboard',
  'example-doc-kami-parchment',
  'example-finance-report',
  'example-flowai-live-dashboard-template',
  'example-gamified-app',
  'example-hyperframes',
  'example-kami-landing',
  'example-kanban-board',
  'example-live-artifact',
  'example-live-dashboard',
  'example-mobile-app',
  'example-mobile-onboarding',
  'example-mockup-device-3d',
  'example-motion-frames',
  'example-pricing-page',
  'example-saas-landing',
  'example-social-carousel',
  'example-social-media-matrix-tracker-template',
  'example-trading-analysis-dashboard-template',
  'example-velar-luxury-real-estate',
  'example-video-hyperframes',
  'example-waitlist-page',
  'example-web-prototype',
  'example-web-prototype-taste-brutalist',
  'example-web-prototype-taste-editorial',
  'example-web-prototype-taste-soft',
  'example-webgl-aurora-veil',
  'example-webgl-caustic-pool',
  'example-webgl-depth-gallery',
  'example-webgl-distortion-grain',
  'example-webgl-experience',
  'example-webgl-halftone-drift',
  'example-webgl-holographic-foil',
  'example-webgl-horizontal-parallax',
  'example-webgl-liquid-iridescence',
  'example-webgl-liquid-metal',
  'example-webgl-neon-grid',
  'example-webgl-particle-galaxy',
  'example-webgl-pixel-reveal-gallery',
  'example-webgl-raymarched-hero',
  'example-webgl-voronoi-cells',
  'example-wireframe-annotated',
  'example-wireframe-greybox',
  'example-wireframe-mobile-flow',
  'example-wireframe-sketch',
  'example-worker-visualizer',
  'image-template-notion-team-dashboard-live-artifact',
  'image-template-profile-avatar-anime-girl-to-cinematic-photo',
  'image-template-profile-avatar-casual-fashion-grid-photoshoot',
  'image-template-profile-avatar-cyberpunk-anime-portrait-with-neon-face-text',
  'image-template-profile-avatar-glamorous-woman-in-black-portrait',
  'image-template-profile-avatar-hyper-realistic-selfie-texture-prompts',
  'image-template-profile-avatar-monochrome-studio-portrait',
  'image-template-profile-avatar-old-photo-restoration-to-dslr-portrait',
  'image-template-profile-avatar-professional-identity-portrait-wallpaper',
  'image-template-profile-avatar-realistically-imperfect-ai-selfie',
  'image-template-profile-avatar-signed-marker-portrait-on-shikishi',
  'video-template-frame-creative-voltage',
  'video-template-frame-data-chart-nyt',
  'video-template-frame-data-rollup',
  'video-template-frame-glitch-title',
  'video-template-frame-kinetic-type',
  'video-template-frame-liquid-bg-hero',
  'video-template-frame-takram-organic',
] as const;

// Flow plugins: installed for id-based dispatch, never rendered as tiles.
const HIDDEN_FLOW_ROSTER = [
  'example-simple-deck',
  'example-web-clone',
  'od-code-migration',
  'od-default',
  'od-design-refine',
  'od-figma-migration',
  'od-media-generation',
  'od-new-generation',
  'od-nextjs-export',
  'od-plugin-authoring',
  'od-plugin-contribute-open-design',
  'od-plugin-publish-github',
  'od-react-export',
  'od-share-to-community',
  'od-tune-collab',
  'od-vue-export',
  'od-web-effect-extractor',
] as const;

interface BundledManifest {
  name?: string;
  od?: { kind?: string };
  tags?: string[];
}

function bundledManifests(): BundledManifest[] {
  const manifests: BundledManifest[] = [];
  for (const tier of readdirSync(BUNDLED_ROOT, { withFileTypes: true })) {
    if (!tier.isDirectory()) continue;
    const tierDir = path.join(BUNDLED_ROOT, tier.name);
    // Direct manifest folder at the top level (bundled.ts registers these
    // without recursing).
    const directManifest = path.join(tierDir, 'open-design.json');
    if (existsSync(directManifest)) {
      manifests.push(JSON.parse(readFileSync(directManifest, 'utf8')) as BundledManifest);
      continue;
    }
    for (const entry of readdirSync(tierDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(tierDir, entry.name, 'open-design.json');
      if (!existsSync(manifestPath)) continue; // asset folder without a manifest
      manifests.push(JSON.parse(readFileSync(manifestPath, 'utf8')) as BundledManifest);
    }
  }
  return manifests;
}

describe('bundled gallery roster', () => {
  it('renders exactly the 90 curated bundled tiles and hides every flow plugin', () => {
    const manifests = bundledManifests();
    const visible = manifests
      .filter((manifest) => isGalleryVisiblePlugin({ manifest }))
      .map((manifest) => manifest.name)
      .sort();
    expect(visible).toEqual([...VISIBLE_ROSTER]);

    const hiddenFlows = manifests
      .filter((manifest) => manifest.od?.kind !== 'atom' && !isGalleryVisiblePlugin({ manifest }))
      .map((manifest) => manifest.name)
      .sort();
    expect(hiddenFlows).toEqual([...HIDDEN_FLOW_ROSTER]);

    const atoms = manifests.filter((manifest) => manifest.od?.kind === 'atom');
    expect(atoms.length).toBe(13);
    expect(manifests.length).toBe(VISIBLE_ROSTER.length + HIDDEN_FLOW_ROSTER.length + atoms.length);
  });
});
