// Hero/salient crop (S4-3 / C4-2). sharp is the image engine for every
// pixel operation here (decode, downsample, extract, resize) -- what this
// module owns is choosing WHICH vertical window to extract, using a
// row-wise color-variance saliency score: a hero region (imagery, a
// colorful CTA band, branded artwork) reads as high per-pixel channel
// spread; plain background/whitespace/nav chrome reads as low spread. A
// sliding-window sum over that score (rather than sharp's single built-in
// `attention`/`entropy` gravity, which favors a small locally-salient spot
// over a LARGER-but-still-salient region lower on the page -- verified
// empirically against adversarial fixtures shaped like scripts/waves/
// verify-w4.ts's C4-2 carousel case) correctly rewards a bigger colorful
// region over a smaller, more localized one.

import sharp from 'sharp';

/** Downsampled thumbnail width used for the saliency scan -- cheap to
 * compute, and per-row color spread does not need full resolution. */
const THUMB_WIDTH = 64;

/** Picks the `targetWidth` x `targetHeight` window out of `sourceBuffer`
 * (any decodable raster image) that maximizes total color-channel spread,
 * then extracts and resizes that window via sharp to the exact target
 * dimensions. */
export async function cropToHeroWindow(
  sourceBuffer: Buffer,
  targetWidth: number,
  targetHeight: number,
): Promise<{ data: Buffer; width: number; height: number }> {
  const source = sharp(sourceBuffer);
  const meta = await source.metadata();
  const sourceWidth = meta.width ?? targetWidth;
  const sourceHeight = meta.height ?? targetHeight;

  // A source no taller than the target has no window to choose -- sharp's
  // own `fit: 'cover'` already does the right thing (centered scale-crop).
  if (sourceHeight <= targetHeight || sourceWidth <= 0) {
    const { data, info } = await sharp(sourceBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  const { data: thumbData, info: thumbInfo } = await sharp(sourceBuffer)
    .resize(THUMB_WIDTH, null, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowScores = scoreRowsBySaliency(thumbData, thumbInfo.width, thumbInfo.height, thumbInfo.channels);

  const windowRowsFloat = (targetHeight / sourceHeight) * thumbInfo.height;
  const windowRows = Math.max(1, Math.min(thumbInfo.height, Math.round(windowRowsFloat)));
  const bestStartRow = bestWindowStart(rowScores, windowRows);

  const top = Math.round((bestStartRow / thumbInfo.height) * sourceHeight);
  const clampedTop = Math.max(0, Math.min(top, sourceHeight - targetHeight));

  const { data, info } = await sharp(sourceBuffer)
    .extract({ left: 0, top: clampedTop, width: sourceWidth, height: Math.min(targetHeight, sourceHeight - clampedTop) })
    .resize(targetWidth, targetHeight, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/** Per-row saliency: mean max(r,g,b) - min(r,g,b) across the row's pixels
 * -- a direct, cheap proxy for "how colorful/high-contrast is this row",
 * which is exactly what distinguishes real hero imagery from flat
 * background/chrome. */
function scoreRowsBySaliency(data: Buffer, width: number, height: number, channels: number): number[] {
  const scores: number[] = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let rowTotal = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      rowTotal += Math.max(r, g, b) - Math.min(r, g, b);
    }
    scores[y] = rowTotal / Math.max(1, width);
  }
  return scores;
}

/** Sliding-window sum, with a centering tie-break: many windows can share
 * (near enough) the same total score once a window is wide enough to fully
 * contain a hero region smaller than itself -- extra margin on either side
 * contributes ~0 either way. Among those near-tied windows, prefer the one
 * whose center sits closest to the saliency-weighted centroid of all rows,
 * so the hero content lands centered in the crop rather than jammed
 * against one edge by an arbitrary first-wins tie-break. */
function bestWindowStart(rowScores: number[], windowRows: number): number {
  const n = rowScores.length;
  const w = Math.min(windowRows, n);

  let totalWeighted = 0;
  let totalScore = 0;
  for (let i = 0; i < n; i++) {
    const score = rowScores[i] ?? 0;
    totalWeighted += score * i;
    totalScore += score;
  }
  const centroid = totalScore > 0 ? totalWeighted / totalScore : n / 2;

  let windowSum = 0;
  for (let i = 0; i < w; i++) windowSum += rowScores[i] ?? 0;

  const sums: number[] = [windowSum];
  let bestSum = windowSum;
  for (let start = 1; start <= n - w; start++) {
    windowSum += (rowScores[start + w - 1] ?? 0) - (rowScores[start - 1] ?? 0);
    sums.push(windowSum);
    if (windowSum > bestSum) bestSum = windowSum;
  }

  const NEAR_TIE_FRACTION = 0.995;
  const tieThreshold = bestSum * NEAR_TIE_FRACTION;
  let bestStart = 0;
  let bestCenterDist = Infinity;
  for (let start = 0; start < sums.length; start++) {
    const sum = sums[start] ?? 0;
    if (sum < tieThreshold) continue;
    const center = start + w / 2;
    const dist = Math.abs(center - centroid);
    if (dist < bestCenterDist) {
      bestCenterDist = dist;
      bestStart = start;
    }
  }
  return bestStart;
}
