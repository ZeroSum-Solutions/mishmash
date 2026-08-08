import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_LOCK_FILENAME,
  catalogLockCommand,
  classifyNeuformEntry,
  deriveAspects,
  deriveStacks,
  mergeOwnedCatalogGroups,
  resolveConfiguredTarget,
  type NeuformEntry,
  withCatalogWriterLock,
} from '../../scripts/import-neuform-favorites.js';
import type { DesignLibraryGroup } from '@open-design/contracts';

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

function group(folder: string, marker: string): DesignLibraryGroup {
  return {
    title: marker,
    folder,
    blurb: marker,
    items: [],
  };
}

describe('NeuForm favorites catalog writer', () => {
  it('selects matching Darwin and Linux lock commands and rejects native Windows', () => {
    const command = '/node';
    const commandArgs = ['-e', 'helper'];
    const lockPath = '/library/.catalog/catalog.lock';

    expect(catalogLockCommand('darwin', lockPath, command, commandArgs)).toEqual({
      executable: '/usr/bin/lockf',
      args: ['-k', '-t', '0', lockPath, command, ...commandArgs],
    });
    expect(catalogLockCommand('linux', lockPath, command, commandArgs)).toEqual({
      executable: '/usr/bin/flock',
      args: ['-n', lockPath, command, ...commandArgs],
    });
    expect(() => catalogLockCommand('win32', lockPath, command, commandArgs)).toThrow(
      'unsupported on native Windows; use WSL2',
    );
  });

  it('replaces only its exact declared group folders and preserves foreign groups', () => {
    const foreign = group('05 NeuForm Favorites/Custom', 'foreign-rich-fields');
    const existing = [
      group('01 UI8 Kits', 'python-owned'),
      group('05 NeuForm Favorites/Templates', 'old-template'),
      foreign,
      group('05 NeuForm Favorites/Tools', 'old-tools'),
    ];
    const replacements = [
      group('05 NeuForm Favorites/Templates', 'new-template'),
      group('05 NeuForm Favorites/Components', 'new-components'),
      group('05 NeuForm Favorites/Tools', 'new-tools'),
    ];

    const merged = mergeOwnedCatalogGroups(existing, replacements);

    expect(merged).toEqual([
      existing[0],
      replacements[0],
      foreign,
      replacements[2],
      replacements[1],
    ]);
    expect(merged[2]).toBe(foreign);
  });

  it('serializes writers through the shared exclusive lockfile', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'od-catalog-lock-'));
    await mkdir(path.join(root, '.catalog'), { recursive: true });
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });

    try {
      const first = withCatalogWriterLock(root, async () => {
        firstEntered();
        await holdFirst;
      });
      await entered;
      let secondEntered = false;
      const second = withCatalogWriterLock(root, async () => {
        secondEntered = true;
      }, { timeoutMs: 1_000, retryMs: 5 });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(secondEntered).toBe(false);
      releaseFirst();
      await Promise.all([first, second]);
      expect(secondEntered).toBe(true);

      const lockPath = path.join(root, '.catalog', CATALOG_LOCK_FILENAME);
      const metadata = JSON.parse(await readFile(lockPath, 'utf8')) as { version: number; token: string };
      expect(metadata.version).toBe(1);
      expect(metadata.token).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects blank and relative configured targets', () => {
    expect(() => resolveConfiguredTarget('', 'OD_DESIGN_LIBRARY_DIR')).toThrow('must not be blank');
    expect(() => resolveConfiguredTarget('   ', 'OD_DESIGN_LIBRARY_DIR')).toThrow('must not be blank');
    expect(() => resolveConfiguredTarget('relative-library', 'OD_DESIGN_LIBRARY_DIR')).toThrow('must be an absolute path');
  });
});
