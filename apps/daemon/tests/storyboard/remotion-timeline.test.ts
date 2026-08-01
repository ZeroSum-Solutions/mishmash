// Fast, hermetic unit tests for the Remotion finishing pass's timeline math
// (storyboards/remotion/timeline.ts). Pure functions, no server/ffmpeg/render
// involved — the cheapest layer that can see this bug (per AGENTS.md's Bug
// follow-up workflow: "try the cheapest layer first").
//
// Regression coverage: TransitionSeries throws ("The duration of a
// <TransitionSeries.Sequence /> must not be shorter than the duration of the
// ... <TransitionSeries.Transition />") when a transition is longer than
// either of its two neighboring segments. ffprobe-measured real clip
// durations aren't guaranteed to be >= TRANSITION_SECONDS (a renderer can
// produce a shorter file than the requested duration) — planTimeline must
// clamp every transition to the shorter neighbor so this never reaches
// Remotion as an opaque 500.

import { describe, expect, it } from 'vitest';
import { FPS, planTimeline, TRANSITION_SECONDS } from '../../src/storyboards/remotion/timeline.js';

describe('planTimeline', () => {
  it('clamps a transition to a sub-TRANSITION_SECONDS clip instead of exceeding it', () => {
    const targetTransitionFrames = Math.round(TRANSITION_SECONDS * FPS);
    // A 0.2s clip is well under the 0.5s default transition duration.
    const shortClipDurationSec = 0.2;
    const plan = planTimeline({
      clips: [
        { fileName: 'clip-0.mp4', durationSec: 4 },
        { fileName: 'clip-1.mp4', durationSec: shortClipDurationSec },
        { fileName: 'clip-2.mp4', durationSec: 4 },
      ],
      titleEnabled: true,
      transitionsEnabled: true,
    });

    const shortClipFrames = plan.clipFrames[1];
    expect(shortClipFrames).toBeLessThan(targetTransitionFrames);

    // Every transition must never exceed EITHER of its two neighboring
    // segments — the exact invariant TransitionSeries enforces at render
    // time. segmentFrames mirrors planTimeline's own construction: title
    // first (since titleEnabled), then each clip in order.
    const segmentFrames = [plan.titleFrames, ...plan.clipFrames];
    expect(plan.transitionFrames).toHaveLength(segmentFrames.length - 1);
    plan.transitionFrames.forEach((frames, i) => {
      expect(frames).toBeLessThanOrEqual(segmentFrames[i] as number);
      expect(frames).toBeLessThanOrEqual(segmentFrames[i + 1] as number);
    });

    // The transitions touching the short clip (index 1 -> segment index 2)
    // are specifically clamped down from the 0.5s default.
    expect(plan.transitionFrames[1]).toBeLessThan(targetTransitionFrames);
    expect(plan.transitionFrames[2]).toBeLessThan(targetTransitionFrames);

    expect(plan.totalDurationInFrames).toBeGreaterThan(0);
    expect(Number.isFinite(plan.totalDurationInFrames)).toBe(true);
  });

  it('never produces a negative or zero-length transition', () => {
    const plan = planTimeline({
      clips: [
        { fileName: 'clip-0.mp4', durationSec: 0.05 },
        { fileName: 'clip-1.mp4', durationSec: 0.05 },
      ],
      titleEnabled: false,
      transitionsEnabled: true,
    });
    for (const frames of plan.transitionFrames) {
      expect(frames).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces no transitions when transitions are disabled, regardless of clip length', () => {
    const plan = planTimeline({
      clips: [
        { fileName: 'clip-0.mp4', durationSec: 0.1 },
        { fileName: 'clip-1.mp4', durationSec: 0.1 },
      ],
      titleEnabled: true,
      transitionsEnabled: false,
    });
    expect(plan.transitionFrames).toHaveLength(0);
    expect(plan.totalDurationInFrames).toBe(plan.titleFrames + plan.clipFrames.reduce((a, b) => a + b, 0));
  });

  it('clamps normally-sized transitions to the target when clips are comfortably long', () => {
    const targetTransitionFrames = Math.round(TRANSITION_SECONDS * FPS);
    const plan = planTimeline({
      clips: [
        { fileName: 'clip-0.mp4', durationSec: 4 },
        { fileName: 'clip-1.mp4', durationSec: 4 },
      ],
      titleEnabled: true,
      transitionsEnabled: true,
    });
    for (const frames of plan.transitionFrames) {
      expect(frames).toBe(targetTransitionFrames);
    }
  });
});
