// Pure timeline math shared by the Remotion composition (composition.tsx's
// calculateMetadata, which runs inside the bundled browser context) and the
// Node-side render orchestrator (render.ts). Kept dependency-free (no React)
// so both sides compute the exact same frame counts from the exact same
// inputProps — a duration mismatch between the Composition's declared
// metadata and the JSX it renders is a real Remotion footgun, not a
// hypothetical one.

export const FPS = 30;
export const TITLE_SECONDS = 2;
export const TRANSITION_SECONDS = 0.5;

export function secondsToFrames(seconds: number): number {
  return Math.max(1, Math.round(seconds * FPS));
}

export interface TimelineClip {
  /** Filename inside the render's public dir, e.g. "clip-0.mp4". */
  fileName: string;
  /** Real probed duration of the clip, in seconds. */
  durationSec: number;
}

export interface TimelinePlan {
  titleFrames: number;
  /**
   * One entry per adjacent segment pair (title-to-clip[0] when the title is
   * enabled, then clip[i]-to-clip[i+1] for every remaining pair) — same
   * indexing composition.tsx renders transitions in. Each entry is clamped
   * to the shorter of its two neighboring segments' frame counts:
   * TransitionSeries throws ("duration of a <TransitionSeries.Sequence />
   * must not be shorter than the duration of the ... <TransitionSeries.Transition />")
   * when a transition is longer than either neighbor, and ffprobe-measured
   * clip durations aren't guaranteed to be >= TRANSITION_SECONDS (a renderer
   * can produce a shorter file than the requested duration). Empty when
   * transitions are disabled or there's only one segment.
   */
  transitionFrames: number[];
  clipFrames: number[];
  totalDurationInFrames: number;
}

export function planTimeline(input: {
  clips: TimelineClip[];
  titleEnabled: boolean;
  transitionsEnabled: boolean;
}): TimelinePlan {
  const clipFrames = input.clips.map((clip) => secondsToFrames(clip.durationSec));
  const titleFrames = input.titleEnabled ? secondsToFrames(TITLE_SECONDS) : 0;
  const segmentFrames = input.titleEnabled ? [titleFrames, ...clipFrames] : clipFrames;

  const targetTransitionFrames = secondsToFrames(TRANSITION_SECONDS);
  const transitionFrames: number[] = [];
  if (input.transitionsEnabled) {
    for (let i = 0; i < segmentFrames.length - 1; i++) {
      // Non-null: i and i+1 are both valid indices into segmentFrames by the
      // loop bound above.
      const left = segmentFrames[i] as number;
      const right = segmentFrames[i + 1] as number;
      transitionFrames.push(Math.max(0, Math.min(targetTransitionFrames, left, right)));
    }
  }

  const rawTotal = segmentFrames.reduce((sum, frames) => sum + frames, 0);
  const totalTransitionFrames = transitionFrames.reduce((sum, frames) => sum + frames, 0);
  const totalDurationInFrames = Math.max(1, rawTotal - totalTransitionFrames);
  return { titleFrames, transitionFrames, clipFrames, totalDurationInFrames };
}

const RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

const DEFAULT_DIMENSIONS = { width: 1280, height: 720 };

/** Falls back to 16:9 for any ratio the map doesn't recognize. */
export function dimensionsForRatio(ratio: string): { width: number; height: number } {
  return RATIO_DIMENSIONS[ratio] ?? DEFAULT_DIMENSIONS;
}
