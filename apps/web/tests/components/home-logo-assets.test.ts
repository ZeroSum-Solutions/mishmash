import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');
const readBinary = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url));
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

const homeHeroSource = read('../../src/components/HomeHero.tsx');
const entryNavRailSource = read('../../src/components/EntryNavRail.tsx');
const layoutSource = read('../../app/layout.tsx');
const logoSvg = read('../../public/logo.svg');
const brandIconSvg = read('../../public/brand-icon.svg');
const appIconPng = readBinary('../../public/app-icon.png');
const logoPng = readBinary('../../public/logo.png');

// The pre-fork Open Design cursor-glyph PNGs this fork replaced. Pinned so a
// regression back to the retired raster assets fails even though the bytes
// carry no readable marker the way the SVGs' comment strings do.
const RETIRED_APP_ICON_PNG_SHA256 =
  '3141cc3b348ac538c68d615cde8cf642abc0b1fb60f44a520853b499982a74cb';
const RETIRED_LOGO_PNG_SHA256 =
  'b8f95c00d25f3bc2af03a03eb9236cff4745e923e28528efc45c04dc1f9f93ff';

// The current MishMash brand glyph is a minimal neutral monogram placeholder
// (P6 replaces it with a designed mark). Every export carries this marker
// comment so this spec can confirm the swap without depending on path data.
const CURRENT_GLYPH_MARKER = 'MishMash monogram mark';
// Retired glyphs: the pre-fork Open Design 444x444 dark tile (#202020, cursor
// arrow path 'M212.059'), and the later Open Design ink superellipse tile
// ('M41 0.726562') replaced by this fork's de-brand pass.
const RETIRED_GLYPH_MARKERS = ['#202020', 'M212.059', 'width="444"', 'M41 0.726562'];

describe('Home logo assets', () => {
  it('ships the current brand glyph in the public logo assets', () => {
    expect(logoSvg).toContain(CURRENT_GLYPH_MARKER);
    expect(brandIconSvg).toContain(CURRENT_GLYPH_MARKER);
    // Marker comments alone can lie — require the rendered MM monogram too.
    expect(logoSvg).toContain('>MM<');
    expect(brandIconSvg).toContain('>MM<');
    for (const marker of RETIRED_GLYPH_MARKERS) {
      expect(logoSvg).not.toContain(marker);
      expect(brandIconSvg).not.toContain(marker);
    }
  });

  it('keeps brand-icon.svg maskable (theme color comes from CSS)', () => {
    expect(brandIconSvg).toContain('currentColor');
  });

  it('renders the brand glyph on both Home entry surfaces', () => {
    expect(homeHeroSource).toContain('od-brand-glyph');
    expect(homeHeroSource).not.toContain('src="/app-icon.svg"');

    expect(entryNavRailSource).toContain('od-brand-glyph');
    expect(entryNavRailSource).not.toContain('src="/app-icon.svg"');
  });

  // NM-02 / C2-4: the SVGs were fixed first, but app-icon.png and logo.png
  // still shipped the old Open Design cursor glyph in raster form — and
  // layout.tsx wires app-icon.png as both favicon and apple-touch-icon, so
  // the browser tab and iOS home-screen icon stayed old-brand even after the
  // SVG fix. PNGs carry no readable marker string, so this pins content
  // hashes instead: the current bytes must differ from the retired asset's
  // hash, proving the raster replacement actually happened and guarding
  // against silently reverting to it later.
  it('ships the current (non-retired) brand PNGs for favicon and apple-touch-icon', () => {
    expect(appIconPng.length).toBeGreaterThan(0);
    expect(logoPng.length).toBeGreaterThan(0);

    const appIconHash = sha256(appIconPng);
    const logoHash = sha256(logoPng);

    expect(appIconHash).not.toBe(RETIRED_APP_ICON_PNG_SHA256);
    expect(logoHash).not.toBe(RETIRED_LOGO_PNG_SHA256);
  });

  it('keeps the PNG raster dimensions consistent with their original export sizes', () => {
    // PNG signature is 8 bytes; the IHDR chunk immediately follows with a
    // 4-byte length, 4-byte "IHDR" type, then big-endian width/height
    // uint32s at offsets 16 and 20 (https://www.w3.org/TR/png/#11IHDR).
    const readPngDimensions = (buf: Buffer) => ({
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    });

    expect(appIconPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(logoPng.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    expect(readPngDimensions(appIconPng)).toEqual({ width: 1024, height: 1024 });
    expect(readPngDimensions(logoPng)).toEqual({ width: 500, height: 500 });
  });

  it('wires app-icon.png as both the favicon and the apple-touch-icon', () => {
    expect(layoutSource).toContain("icon: '/app-icon.png'");
    expect(layoutSource).toContain("apple: '/app-icon.png'");
  });
});
