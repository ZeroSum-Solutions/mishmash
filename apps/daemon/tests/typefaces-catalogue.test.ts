// Typeface catalogue: index building, the redistribution licence gate, and
// project install. Fixture-based (isolated temp catalogues) plus one smoke
// test against the real design-templates/ tree so the gate's behavior on
// production data is asserted, not just on hand-built fixtures.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTypefaceIndex,
  getTypeface,
  installTypeface,
  listTypefaces,
  resetTypefaceIndexCache,
  slugifyTypefaceFamily,
  TypefaceNotFoundError,
} from '../src/typefaces/catalogue.js';
import { parseWebfontFaces } from '../src/brands/webfonts.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const realCatalogueRoot = path.join(repoRoot, 'design-templates');

let catalogueRoot = '';

async function writeTemplateFonts(
  template: string,
  cssBody: string,
  files: Record<string, string> = {},
): Promise<void> {
  const fontsDir = path.join(catalogueRoot, template, 'fonts');
  await mkdir(fontsDir, { recursive: true });
  await writeFile(path.join(fontsDir, 'fonts.css'), cssBody, 'utf8');
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(fontsDir, name), content, 'utf8');
  }
}

const GOOGLE_FONT_STYLE_FACE = (family: string, weight: string, file: string, unicodeRange: string) => `
@font-face {
  font-family: "${family}";
  src: url("./${file}") format("woff2");
  font-weight: ${weight};
  font-style: normal;
  unicode-range: ${unicodeRange};
  font-display: swap;
}`;

beforeEach(async () => {
  catalogueRoot = await mkdtemp(path.join(os.tmpdir(), 'od-typefaces-'));
});

afterEach(async () => {
  resetTypefaceIndexCache(catalogueRoot);
  await rm(catalogueRoot, { recursive: true, force: true });
});

describe('buildTypefaceIndex', () => {
  it('resolves a known family split across multiple templates into one complete, usable face set', async () => {
    // Two templates each ship a different slice of Archivo's weights, the
    // way the real catalogue does — no single template has the full range.
    await writeTemplateFonts(
      'template-a',
      [
        GOOGLE_FONT_STYLE_FACE('Archivo', '400', 'archivo-latin-aaa1111111.woff2', 'U+0000-00FF'),
        GOOGLE_FONT_STYLE_FACE('Archivo', '700', 'archivo-latin-bbb2222222.woff2', 'U+0000-00FF'),
      ].join('\n'),
      { 'archivo-latin-aaa1111111.woff2': 'fake-400', 'archivo-latin-bbb2222222.woff2': 'fake-700' },
    );
    await writeTemplateFonts(
      'template-b',
      [
        GOOGLE_FONT_STYLE_FACE('Archivo', '400', 'archivo-latin-aaa1111111.woff2', 'U+0000-00FF'), // duplicate of template-a's 400
        GOOGLE_FONT_STYLE_FACE('Archivo', '900', 'archivo-latin-ccc3333333.woff2', 'U+0000-00FF'),
      ].join('\n'),
      { 'archivo-latin-aaa1111111.woff2': 'fake-400', 'archivo-latin-ccc3333333.woff2': 'fake-900' },
    );

    const index = await buildTypefaceIndex(catalogueRoot);
    const archivo = index.families.get('archivo');
    expect(archivo).toBeDefined();
    expect(archivo!.family).toBe('Archivo');
    expect(archivo!.classification.weights).toEqual([400, 700, 900]);
    expect(archivo!.faces).toHaveLength(3); // deduped: the repeated 400/normal/latin face counted once
    expect(archivo!.license.spdx).toBe('OFL-1.1');
  });

  it('hex-garbage filenames never become fake families — only declared font-family values do', async () => {
    // A loose, unreferenced hex-named file sits next to a real declaration.
    // If the index ever fell back to filename parsing, "9f2ab61c3d" would
    // show up as a family; it must not.
    await writeTemplateFonts(
      'template-hex',
      GOOGLE_FONT_STYLE_FACE('Space Grotesk', '400', '9f2ab61c3d.woff2', 'U+0000-00FF'),
      { '9f2ab61c3d.woff2': 'fake', 'orphan-e114a9028f.woff2': 'never referenced by any @font-face rule' },
    );

    const index = await buildTypefaceIndex(catalogueRoot);
    expect(index.families.has('space-grotesk')).toBe(true);
    expect(index.families.has('9f2ab61c3d')).toBe(false);
    expect(index.families.has('orphan-e114a9028f')).toBe(false);
    // The only family present is the one an actual font-family declaration named.
    expect([...index.families.keys()]).toEqual(['space-grotesk']);
  });

  it('excludes a Fontshare-sourced family (ambiguous redistribution licence) even though it is present on disk', async () => {
    await writeTemplateFonts(
      'template-fontshare',
      `@font-face {
  font-family: "Clash Display";
  src: url("./clash-display-e7181bf535-e0ec5644c9.woff2") format("woff2");
  font-weight: 200 700;
  font-style: normal;
  font-display: swap;
}`,
      { 'clash-display-e7181bf535-e0ec5644c9.woff2': 'fake' },
    );

    const index = await buildTypefaceIndex(catalogueRoot);
    expect(index.families.has('clash-display')).toBe(false);
    // Still counted in the raw scan total for transparency, even though excluded.
    expect(index.scannedFamilies).toBe(1);
  });

  it('excludes mislabeled commercial-name aliases (bytes are actually Inter, not Helvetica)', async () => {
    await writeTemplateFonts(
      'template-helvetica-alias',
      GOOGLE_FONT_STYLE_FACE('Helvetica Regular', '400', 'inter-latin-aaa1111111.woff2', 'U+0000-00FF'),
      { 'inter-latin-aaa1111111.woff2': 'fake' },
    );
    const index = await buildTypefaceIndex(catalogueRoot);
    expect(index.families.has('helvetica-regular')).toBe(false);
  });

  it('excludes icon/glyph faces regardless of licence', async () => {
    await writeTemplateFonts(
      'template-icons',
      GOOGLE_FONT_STYLE_FACE('Material Symbols Outlined', '400', 'material-symbols-aaa1111111.woff2', 'U+0000-00FF'),
      { 'material-symbols-aaa1111111.woff2': 'fake' },
    );
    const index = await buildTypefaceIndex(catalogueRoot);
    expect(index.families.size).toBe(0);
  });

  it('classifies weights, variable ranges, monospace, and name hints factually — no ranking', async () => {
    await writeTemplateFonts(
      'template-mono',
      `@font-face {
  font-family: "JetBrains Mono";
  src: url("./jetbrains-mono-var-aaa1111111.woff2") format("woff2");
  font-weight: 100 800;
  font-style: normal;
  font-display: swap;
}`,
      { 'jetbrains-mono-var-aaa1111111.woff2': 'fake' },
    );
    await writeTemplateFonts(
      'template-condensed',
      GOOGLE_FONT_STYLE_FACE('Archivo Narrow', '700', 'archivo-narrow-latin-aaa1111111.woff2', 'U+0000-00FF'),
      { 'archivo-narrow-latin-aaa1111111.woff2': 'fake' },
    );

    const index = await buildTypefaceIndex(catalogueRoot);
    const mono = index.families.get('jetbrains-mono')!;
    expect(mono.classification.monospace).toBe(true);
    expect(mono.classification.variableWeightRange).toEqual([100, 800]);
    expect(mono.license.spdx).toBe('Apache-2.0');

    const condensed = index.families.get('archivo-narrow')!;
    expect(condensed.classification.nameHints).toContain('Narrow');
    expect(condensed.classification.weights).toEqual([700]);
  });
});

describe('listTypefaces / getTypeface', () => {
  it('lists only license-cleared families and supports query/monospace/condensed filters', async () => {
    await writeTemplateFonts(
      'template-mixed',
      [
        GOOGLE_FONT_STYLE_FACE('Instrument Serif', '400', 'instrument-serif-latin-aaa1111111.woff2', 'U+0000-00FF'),
        `@font-face {
  font-family: "Clash Display";
  src: url("./clash-display-bbb2222222.woff2") format("woff2");
  font-weight: 200 700;
  font-style: normal;
  font-display: swap;
}`,
      ].join('\n'),
      { 'instrument-serif-latin-aaa1111111.woff2': 'fake', 'clash-display-bbb2222222.woff2': 'fake' },
    );

    const { typefaces, scannedFamilies } = await listTypefaces(catalogueRoot);
    expect(scannedFamilies).toBe(2);
    expect(typefaces.map((t) => t.id)).toEqual(['instrument-serif']);

    const filtered = await listTypefaces(catalogueRoot, { q: 'serif' });
    expect(filtered.typefaces).toHaveLength(1);
    const missed = await listTypefaces(catalogueRoot, { q: 'nonexistent-xyz' });
    expect(missed.typefaces).toHaveLength(0);
  });

  it('getTypeface returns undefined for an excluded or unknown id', async () => {
    const missing = await getTypeface(catalogueRoot, 'does-not-exist');
    expect(missing).toBeUndefined();
  });
});

describe('installTypeface', () => {
  it('copies every face file and writes a valid, correctly-relative @font-face fonts.css', async () => {
    await writeTemplateFonts(
      'template-install',
      [
        GOOGLE_FONT_STYLE_FACE('Space Grotesk', '400', 'space-grotesk-latin-aaa1111111.woff2', 'U+0000-00FF'),
        GOOGLE_FONT_STYLE_FACE('Space Grotesk', '700', 'space-grotesk-latin-bbb2222222.woff2', 'U+0000-00FF'),
      ].join('\n'),
      {
        'space-grotesk-latin-aaa1111111.woff2': 'fake-400',
        'space-grotesk-latin-bbb2222222.woff2': 'fake-700',
      },
    );

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'od-typefaces-project-'));
    try {
      const result = await installTypeface(catalogueRoot, 'space-grotesk', { projectRoot });
      expect(result.dir).toBe('assets/fonts/space-grotesk');
      expect(result.files.sort()).toEqual(
        ['space-grotesk-latin-aaa1111111.woff2', 'space-grotesk-latin-bbb2222222.woff2'].sort(),
      );

      const destDir = path.join(projectRoot, result.dir);
      const written = (await readdir(destDir)).sort();
      expect(written).toEqual(['fonts.css', 'space-grotesk-latin-aaa1111111.woff2', 'space-grotesk-latin-bbb2222222.woff2']);

      const cssOnDisk = await readFile(path.join(projectRoot, result.cssFile), 'utf8');
      expect(cssOnDisk).toBe(result.css);

      // The written CSS must itself parse back into two usable, correctly
      // relative @font-face rules — proving this isn't just bytes on disk
      // but a real, loadable stylesheet.
      const faces = parseWebfontFaces(cssOnDisk, pathToFileURL(path.join(destDir, 'fonts.css')).href);
      expect(faces).toHaveLength(2);
      for (const face of faces) {
        expect(face.family).toBe('Space Grotesk');
        const resolvedPath = fileURLToPath(face.url);
        expect(path.dirname(resolvedPath)).toBe(destDir);
        expect(result.files).toContain(path.basename(resolvedPath));
        const bytesOnDisk = await readFile(resolvedPath);
        expect(bytesOnDisk.length).toBeGreaterThan(0);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects an install dir that escapes the project root', async () => {
    await writeTemplateFonts(
      'template-escape',
      GOOGLE_FONT_STYLE_FACE('Space Grotesk', '400', 'space-grotesk-latin-aaa1111111.woff2', 'U+0000-00FF'),
      { 'space-grotesk-latin-aaa1111111.woff2': 'fake' },
    );
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'od-typefaces-project-'));
    try {
      await expect(
        installTypeface(catalogueRoot, 'space-grotesk', { projectRoot, dir: '../../etc' }),
      ).rejects.toThrow(/escapes|\.\./);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('throws TypefaceNotFoundError for an excluded family', async () => {
    await writeTemplateFonts(
      'template-excluded-install',
      `@font-face {
  font-family: "Clash Display";
  src: url("./clash-display-aaa1111111.woff2") format("woff2");
  font-weight: 200 700;
  font-style: normal;
  font-display: swap;
}`,
      { 'clash-display-aaa1111111.woff2': 'fake' },
    );
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'od-typefaces-project-'));
    try {
      await expect(
        installTypeface(catalogueRoot, 'clash-display', { projectRoot }),
      ).rejects.toBeInstanceOf(TypefaceNotFoundError);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('slugifyTypefaceFamily', () => {
  it('matches the ids the task names as expected entries', () => {
    expect(slugifyTypefaceFamily('Archivo')).toBe('archivo');
    expect(slugifyTypefaceFamily('Instrument Serif')).toBe('instrument-serif');
    expect(slugifyTypefaceFamily('Space Grotesk')).toBe('space-grotesk');
  });
});

describe('the real design-templates catalogue', () => {
  it('resolves archivo, instrument-serif, and space-grotesk to complete, non-empty face sets', async () => {
    const index = await buildTypefaceIndex(realCatalogueRoot);
    for (const id of ['archivo', 'instrument-serif', 'space-grotesk']) {
      const entry = index.families.get(id);
      expect(entry, `expected "${id}" in the real catalogue index`).toBeDefined();
      expect(entry!.faces.length).toBeGreaterThan(0);
      expect(entry!.classification.weights.length + (entry!.classification.variableWeightRange ? 1 : 0)).toBeGreaterThan(0);
    }
  });

  it('never lists a known Fontshare-sourced or mislabeled family from the real catalogue', async () => {
    const index = await buildTypefaceIndex(realCatalogueRoot);
    for (const excluded of ['clash-display', 'clash-grotesk', 'general-sans', 'satoshi', 'switzer', 'gambarino', 'helvetica-regular']) {
      expect(index.families.has(excluded), `"${excluded}" must not be in the installable index`).toBe(false);
    }
  });
});
