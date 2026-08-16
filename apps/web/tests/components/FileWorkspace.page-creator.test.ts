import { describe, expect, it } from 'vitest';

import {
  pageCreatorCategoryVisible,
  pageCreatorPresetVisible,
  pagePresetMatchesCategory,
} from '../../src/components/FileWorkspace';

function preset(overrides: Partial<{
  id: string;
  category: string;
  icon: string;
  fileBaseName: string;
  source: 'blank' | 'community';
  featured: boolean;
}> = {}) {
  return {
    id: 'preset-1',
    category: 'prototype',
    icon: 'file-line',
    fileBaseName: 'prototype',
    source: 'community',
    ...overrides,
  } as never;
}

describe('pageCreatorCategoryVisible', () => {
  it('hides the synthetic "recommended" tab from the category filter row', () => {
    // "recommended" is a virtual facet (featured presets), not a real preset
    // category — showing it as its own filterable category would double the
    // Recommended presets into a second, redundant tab.
    expect(pageCreatorCategoryVisible('recommended')).toBe(false);
  });

  it('hides image, video, and audio — those presets have their own dedicated launcher, not the page creator grid', () => {
    expect(pageCreatorCategoryVisible('image')).toBe(false);
    expect(pageCreatorCategoryVisible('video')).toBe(false);
    expect(pageCreatorCategoryVisible('audio')).toBe(false);
  });

  it('shows the remaining real page categories', () => {
    expect(pageCreatorCategoryVisible('slides')).toBe(true);
    expect(pageCreatorCategoryVisible('prototype')).toBe(true);
    expect(pageCreatorCategoryVisible('wireframe')).toBe(true);
    expect(pageCreatorCategoryVisible('mobile')).toBe(true);
    expect(pageCreatorCategoryVisible('document')).toBe(true);
    expect(pageCreatorCategoryVisible('hyperframes')).toBe(true);
    expect(pageCreatorCategoryVisible('liveArtifact')).toBe(true);
  });
});

describe('pageCreatorPresetVisible', () => {
  it('excludes the blank starter preset for each category — those launch from the New page menu, not the gallery grid', () => {
    expect(pageCreatorPresetVisible(preset({ id: 'blank-prototype', source: 'blank', category: 'prototype' })))
      .toBe(false);
  });

  it('excludes a community preset whose category is hidden even though its own source is not blank', () => {
    expect(pageCreatorPresetVisible(preset({ source: 'community', category: 'video' }))).toBe(false);
  });

  it('shows a non-blank preset in a visible category', () => {
    expect(pageCreatorPresetVisible(preset({ source: 'community', category: 'prototype' }))).toBe(true);
  });
});

describe('pagePresetMatchesCategory', () => {
  it('matches the "recommended" tab only against featured presets, regardless of their real category', () => {
    expect(pagePresetMatchesCategory(preset({ category: 'video', featured: true }), 'recommended')).toBe(true);
    expect(pagePresetMatchesCategory(preset({ category: 'video', featured: false }), 'recommended')).toBe(false);
    expect(pagePresetMatchesCategory(preset({ category: 'video' }), 'recommended')).toBe(false);
  });

  it('matches a real category tab by exact category equality, ignoring the featured flag', () => {
    expect(pagePresetMatchesCategory(preset({ category: 'slides', featured: true }), 'slides')).toBe(true);
    expect(pagePresetMatchesCategory(preset({ category: 'slides', featured: false }), 'slides')).toBe(true);
    expect(pagePresetMatchesCategory(preset({ category: 'slides' }), 'prototype')).toBe(false);
  });
});
