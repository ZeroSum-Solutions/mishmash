// ffprobe-based duration probe for a rendered shot's clip file — the
// Remotion timeline needs the clip's REAL duration (not the requested
// shot.durationSec, which can drift slightly from what the renderer actually
// produced) to size each <TransitionSeries.Sequence> correctly. Bounded via
// spawnWithTimeout (review finding T1) so a hung ffprobe can't hold the
// assemble request open indefinitely — the caller passes however much of the
// overall finishing-pass deadline remains.

import { spawnWithTimeout } from './spawn-with-timeout.js';

export async function probeDurationSec(filePath: string, timeoutMs: number): Promise<number> {
  const { stdout } = await spawnWithTimeout(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
    timeoutMs,
    'ffprobe',
  );
  let parsed: { format?: { duration?: string } };
  try {
    parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  } catch (err) {
    throw new Error(`ffprobe returned unparseable output for ${filePath}: ${String(err)}`);
  }
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe returned an invalid duration for ${filePath}`);
  }
  return duration;
}
