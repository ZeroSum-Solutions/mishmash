// Home example-prompt chip filtering — pure derivation contract.
//
// Two invariants this suite locks:
//   1. A video / HyperFrames template that only carries an `audio-reactive`
//      tag must NOT leak into the audio example gallery — its home is the
//      Video / HyperFrames chips. (Regression: the audio rule used a bare
//      substring `hasPart('audio')` that matched `audio-reactive`.)
//   2. The generic `od-media-generation` catch-all router must never appear
//      as an example preset under any media chip, so the "Media generation
//      (default scenario)" card neither shows up nor shows up pre-selected.

import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import {
  homeHeroExamplePluginsForChip,
  pluginMatchesExampleChip,
} from '../../src/components/HomeHero';

interface MakeArgs {
  id: string;
  title?: string;
  tags?: string[];
  mode?: string;
  surface?: string;
  scenario?: string;
}

function make(args: MakeArgs): InstalledPluginRecord {
  return {
    id: args.id,
    title: args.title ?? args.id,
    version: '0.1.0',
    sourceKind: 'bundled',
    source: '/tmp',
    trust: 'bundled',
    capabilitiesGranted: [],
    manifest: {
      name: args.id,
      version: '0.1.0',
      title: args.title ?? args.id,
      ...(args.tags ? { tags: args.tags } : {}),
      od: {
        kind: 'scenario',
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.surface ? { surface: args.surface } : {}),
        ...(args.scenario ? { scenario: args.scenario } : {}),
        // Give every fixture a renderable preset query so the
        // `pluginPresetQuery` filter inside homeHeroExamplePluginsForChip
        // keeps it — isolating the chip-match / hidden-id logic under test.
        useCase: { query: `use ${args.id}` },
      },
    },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: 0,
  } as unknown as InstalledPluginRecord;
}

// Mirrors plugins/_official/video-templates/hyperframes-brand-sizzle-reel.
const brandSizzleReel = make({
  id: 'video-template-hyperframes-brand-sizzle-reel',
  title: 'HyperFrames: 30-Second Brand Sizzle Reel',
  tags: ['video-template', 'first-party', 'video', 'marketing', 'hyperframes', 'sizzle', 'audio-reactive', 'brand'],
  mode: 'video',
  surface: 'video',
  scenario: 'video',
});

// Synthetic audio template shaped like the retired bundled audio-jingle
// example (removed by the 2026-07-30 gallery curation).
const audioJingle = make({
  id: 'sample-audio-jingle',
  title: 'Audio Jingle',
  tags: ['example', 'first-party', 'audio', 'marketing', 'music', 'jingle'],
  mode: 'audio',
  surface: 'audio',
  scenario: 'marketing',
});

// Mirrors plugins/_official/scenarios/od-media-generation (catch-all default).
const mediaGeneration = make({
  id: 'od-media-generation',
  title: 'Media generation (default scenario)',
  tags: ['scenario', 'first-party', 'media-generation', 'image', 'video', 'audio'],
});

// Mirrors plugins/_official/examples/simple-deck: a `scenario`-tagged flow
// plugin dispatched by id, never rendered as a tile in the Workflows-and-Assets
// grid (see galleryVisibility.ts / bundled-roster.test.ts's HIDDEN_FLOW_ROSTER).
// It is NOT in EXAMPLE_PRESET_HIDDEN_PLUGIN_IDS, so only the shared
// isGalleryVisiblePlugin predicate keeps it out of the example-prompt rail too.
const simpleDeckFlow = make({
  id: 'example-simple-deck',
  title: 'Write an Operating Review like a Disciplined COO',
  tags: ['scenario', 'example', 'first-party', 'deck', 'slides'],
  mode: 'deck',
  surface: 'web',
  scenario: 'strategy',
});

describe('pluginMatchesExampleChip — audio chip', () => {
  it('keeps a genuine audio template under the audio chip', () => {
    expect(pluginMatchesExampleChip(audioJingle, 'audio')).toBe(true);
  });

  it('rejects an audio-reactive HyperFrames video template from the audio chip', () => {
    expect(pluginMatchesExampleChip(brandSizzleReel, 'audio')).toBe(false);
  });

  it('still places that HyperFrames template under the hyperframes chip', () => {
    expect(pluginMatchesExampleChip(brandSizzleReel, 'hyperframes')).toBe(true);
  });
});

describe('homeHeroExamplePluginsForChip — audio chip', () => {
  const installed = [audioJingle, brandSizzleReel, mediaGeneration];

  it('shows the audio jingle but neither the HyperFrames reel nor the media-generation default', () => {
    const ids = homeHeroExamplePluginsForChip('audio', installed, 'en').map((p) => p.id);
    expect(ids).toContain('sample-audio-jingle');
    expect(ids).not.toContain('video-template-hyperframes-brand-sizzle-reel');
    expect(ids).not.toContain('od-media-generation');
  });
});

describe('homeHeroExamplePluginsForChip — gallery visibility parity', () => {
  it('hides a scenario-tagged flow plugin from the deck chip rail, matching the Workflows-and-Assets grid', () => {
    const ids = homeHeroExamplePluginsForChip('deck', [simpleDeckFlow], 'en').map((p) => p.id);
    expect(ids).not.toContain('example-simple-deck');
  });
});
