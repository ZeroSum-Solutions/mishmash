// Hero/salient crop (S4-3 / C4-2). Real sharp-decoded synthetic fixtures --
// no mocked image pipeline. See scripts/waves/verify-w4.ts's C4-2 for the
// full adversarial stripe-barcode proof this mirrors at a smaller scale.

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { cropToHeroWindow } from '../../src/covers/crop.js';

const WIDTH = 400;
const SOURCE_HEIGHT = 1200;
const TARGET_WIDTH = 400;
const TARGET_HEIGHT = 300;

/** A tall solid-background image with one vivid colorful band at
 * [heroY0, heroY0+heroHeight) and near-uniform gray filler elsewhere. */
async function makeHeroBandImage(heroY0: number, heroHeight: number): Promise<Buffer> {
  const svg = `<svg width="${WIDTH}" height="${SOURCE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${WIDTH}" height="${SOURCE_HEIGHT}" fill="rgb(128,128,128)"/>
    <rect x="0" y="${heroY0}" width="${WIDTH}" height="${heroHeight}" fill="rgb(255,20,80)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function decodeRaw(buf: Buffer): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Fraction of the cropped output's vertical center column whose pixels
 * are the vivid hero color (a cheap way to check "the crop actually
 * contains the hero", without re-deriving exact crop coordinates). */
async function heroPixelFraction(croppedBuf: Buffer): Promise<number> {
  const { data, width, height, channels } = await decodeRaw(croppedBuf);
  const centerX = Math.floor(width / 2);
  let heroCount = 0;
  for (let y = 0; y < height; y++) {
    const offset = (y * width + centerX) * channels;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    if (r > 200 && g < 80 && b > 40 && b < 140) heroCount++;
  }
  return heroCount / height;
}

describe('cropToHeroWindow', () => {
  it('always produces the exact requested target dimensions', async () => {
    const source = await makeHeroBandImage(600, 120);
    const result = await cropToHeroWindow(source, TARGET_WIDTH, TARGET_HEIGHT);
    expect(result.width).toBe(TARGET_WIDTH);
    expect(result.height).toBe(TARGET_HEIGHT);
  });

  it('favors a hero band near the top of a tall source', async () => {
    const source = await makeHeroBandImage(60, 100);
    const result = await cropToHeroWindow(source, TARGET_WIDTH, TARGET_HEIGHT);
    const fraction = await heroPixelFraction(result.data);
    expect(fraction).toBeGreaterThan(0.2);
  });

  it('favors a hero band in the middle of a tall source (not a naive top-anchored crop)', async () => {
    const source = await makeHeroBandImage(550, 100);
    const result = await cropToHeroWindow(source, TARGET_WIDTH, TARGET_HEIGHT);
    const fraction = await heroPixelFraction(result.data);
    expect(fraction).toBeGreaterThan(0.2);
  });

  it('favors a hero band near the bottom of a tall source', async () => {
    const source = await makeHeroBandImage(SOURCE_HEIGHT - 160, 100);
    const result = await cropToHeroWindow(source, TARGET_WIDTH, TARGET_HEIGHT);
    const fraction = await heroPixelFraction(result.data);
    expect(fraction).toBeGreaterThan(0.2);
  });

  it('a source no taller than the target still resizes to exact target dimensions', async () => {
    const svg = `<svg width="${WIDTH}" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="${WIDTH}" height="200" fill="rgb(10,10,10)"/></svg>`;
    const source = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await cropToHeroWindow(source, TARGET_WIDTH, TARGET_HEIGHT);
    expect(result.width).toBe(TARGET_WIDTH);
    expect(result.height).toBe(TARGET_HEIGHT);
  });
});
