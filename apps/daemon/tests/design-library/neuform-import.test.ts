import { describe, expect, it } from 'vitest';
import {
  classifyNeuformEntry,
  deriveAspects,
  deriveStacks,
  type NeuformEntry,
} from '../../scripts/import-neuform-favorites.js';

function entry(title: string, remoteUrls: string[] = []): NeuformEntry {
  return {
    id: 'synthetic',
    title,
    status: 'complete',
    files: { html: 'designs/synthetic/reference.html', design: 'designs/synthetic/DESIGN.md' },
    source: {
      htmlSha256: null,
      designSha256: null,
      htmlBytes: 10,
      designBytes: 10,
    },
    runtimeDependencies: { remoteUrls, remoteHosts: [] },
  };
}

describe('NeuForm favorites importer taxonomy', () => {
  it('routes Three.js/WebGL references to Tools ahead of their page layout', () => {
    expect(
      classifyNeuformEntry(
        entry('Editorial Landing Page'),
        '## Layout\nEditorial grid\n## WebGL\nParticle field',
        '<script>new THREE.WebGLRenderer()</script>',
      ),
    ).toBe('tools');
  });

  it('routes focused interface pieces to Components and full layouts to Templates', () => {
    expect(classifyNeuformEntry(entry('Expanded Dashboard Cards'), '## Layout\nGrid', '<main />')).toBe('components');
    expect(classifyNeuformEntry(entry('Bespoke Travel'), '## Layout\nEditorial', '<main />')).toBe('templates');
  });

  it('derives selectable aspects and a minimal recommended implementation stack', () => {
    const synthetic = entry('Particle Hero', [
      'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    ]);
    const design = '## Colors\nBlue\n## Layout\nHero grid\n## WebGL\nUse a shader particle field.';
    const html = '<section class="hero backdrop-blur"><script>gsap.registerPlugin(ScrollTrigger); new THREE.Scene()</script>';
    expect(deriveAspects(synthetic, design, html)).toEqual(
      expect.arrayContaining(['WebGL', 'Three.js', 'GSAP motion', 'Hero', 'Layout', 'Color system']),
    );
    expect(deriveStacks(synthetic, design, html)).toEqual(['React', 'Tailwind CSS', 'GSAP', 'Three.js', 'GLSL']);
  });
});
