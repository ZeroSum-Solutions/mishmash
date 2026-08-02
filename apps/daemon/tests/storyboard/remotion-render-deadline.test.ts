// Fast, hermetic tests for renderStoryboardFinish's deadline handling
// (review finding T1) — @remotion/bundler, @remotion/renderer, and the
// ffprobe wrapper are all mocked so a stuck bundle() or stuck renderMedia()
// can be simulated (a promise that never resolves) without a real webpack
// bundle or headless-Chrome render, and without ever waiting anywhere near
// the real (env-tunable, 15-minute-default) budget.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deadline } from '../../src/storyboards/remotion/deadline.js';

const bundleMock = vi.fn();
const selectCompositionMock = vi.fn();
const renderMediaMock = vi.fn();
const cancelMock = vi.fn();
const probeDurationSecMock = vi.fn();

vi.mock('@remotion/bundler', () => ({
  bundle: (...args: unknown[]) => bundleMock(...args),
}));

vi.mock('@remotion/renderer', () => ({
  selectComposition: (...args: unknown[]) => selectCompositionMock(...args),
  renderMedia: (...args: unknown[]) => renderMediaMock(...args),
  makeCancelSignal: () => ({ cancelSignal: (_cb: () => void) => {}, cancel: cancelMock }),
}));

vi.mock('../../src/storyboards/remotion/probe.js', () => ({
  probeDurationSec: (...args: unknown[]) => probeDurationSecMock(...args),
}));

const { renderStoryboardFinish, resetBundleCacheForTests } = await import(
  '../../src/storyboards/remotion/render.js'
);
const { createDeadline, RemotionFinishTimeoutError } = await import('../../src/storyboards/remotion/deadline.js');

// renderStoryboardFinish threads ONE Deadline through every stage
// (bundle -> selectComposition -> renderMedia), each consuming from the same
// remaining-time pool (render.ts). A single small real budget shared across
// all of them (the original createDeadline(80) for every "stage hangs" test)
// makes the LATER-stage tests — "selectComposition() hangs" and especially
// "renderMedia() hangs", which must first pass through 1-2 EARLIER,
// non-hanging stages — flaky under load for a reason that has nothing to do
// with what they're testing: ensureBundled() does two real fs calls (rm,
// mkdir) before it ever reaches the mocked bundle(), and each `await` hop
// needs the JS thread rescheduled, which a loaded machine can delay far
// enough to consume the whole shared budget before the target stage is even
// reached — deadline.assertNotExpired(targetStage) then throws BEFORE the
// code under test reaches makeCancelSignal(), so cancel() is never called.
// That's a real gap in the original design, not something this fix
// introduces — larger fixed shared budgets (500ms, 3s) still hit it
// intermittently in practice, because it's the CUMULATIVE scheduling
// latency of the preceding stages that's unbounded under load, not the
// hang-detection window itself.
//
// hangDeadline() below fixes the actual dependency: every stage OTHER than
// the one under test gets a generous real budget (30s — the same value the
// "resolves normally"/"memoizes" tests already use safely below), so
// incidental setup for earlier stages can never plausibly exhaust it: only
// once assertNotExpired() reports the TARGET stage does the budget collapse
// to a small window. That window then only has to outlast the time between
// "the mocked hang is invoked" and "its setTimeout fires" — no preceding
// real work competes with it anymore.
function hangDeadline(targetStage: string, hangBudgetMs = 300): Deadline {
  let currentStage: string | null = null;
  const before = createDeadline(30_000);
  // Constructed lazily, on the target stage's first assertNotExpired() call
  // — NOT eagerly here at hangDeadline()'s own construction time. Building
  // it up front would start the 300ms clock before the code under test has
  // even reached the target stage, so any scheduling/setup latency in the
  // preceding (generously-budgeted) stages eats into the small window before
  // the target stage's own assertNotExpired() ever runs — reintroducing the
  // exact load-flake this helper exists to fix.
  let atTarget: Deadline | null = null;
  return {
    remainingMs: () => (currentStage === targetStage ? (atTarget ?? before).remainingMs() : before.remainingMs()),
    assertNotExpired(stage: string) {
      currentStage = stage;
      if (stage === targetStage) {
        if (!atTarget) atTarget = createDeadline(hangBudgetMs);
        atTarget.assertNotExpired(stage);
      } else {
        before.assertNotExpired(stage);
      }
    },
  };
}

describe('renderStoryboardFinish deadline handling', () => {
  let scratchDir = '';

  afterEach(async () => {
    bundleMock.mockReset();
    selectCompositionMock.mockReset();
    renderMediaMock.mockReset();
    cancelMock.mockReset();
    probeDurationSecMock.mockReset();
    // bundle() is memoized module-level (Round E) so each test needs a
    // clean slate — otherwise one test's bundle() mock (resolved, hung, or
    // rejected) would leak into the next via the shared cache.
    resetBundleCacheForTests();
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
    scratchDir = '';
  });

  async function makeFixtureClip(): Promise<string> {
    scratchDir = await mkdtemp(path.join(os.tmpdir(), 'od-render-deadline-test-'));
    const clipPath = path.join(scratchDir, 'clip-0.mp4');
    // cp() just needs a real source file to exist; contents are irrelevant
    // since probeDurationSec (ffprobe) is mocked in this suite.
    await writeFile(clipPath, Buffer.from('not a real clip, only needs to exist for cp()'));
    return clipPath;
  }

  it('rejects with a labeled timeout when bundle() hangs past the deadline', async () => {
    probeDurationSecMock.mockResolvedValue(4);
    bundleMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const clipPath = await makeFixtureClip();

    let caught: unknown;
    try {
      await renderStoryboardFinish({
        clipPaths: [clipPath],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(scratchDir, 'final.mp4'),
        deadline: hangDeadline('bundle'),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as InstanceType<typeof RemotionFinishTimeoutError>).stage).toBe('bundle');
    expect(selectCompositionMock).not.toHaveBeenCalled();
    expect(renderMediaMock).not.toHaveBeenCalled();
  });

  it('a hung bundle() keeps 504ing subsequent requests, labeled "bundle", without a second bundle() call', async () => {
    // Terra re-check pin: bundle() is memoized per-process, so a stuck
    // compile must not be retried by every request that arrives while it's
    // hung — each request still gets its OWN per-request deadline/504, but
    // they all race the SAME underlying (never-settling) bundle() call.
    probeDurationSecMock.mockResolvedValue(4);
    bundleMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const clipPath = await makeFixtureClip();

    const attempt = () =>
      renderStoryboardFinish({
        clipPaths: [clipPath],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(scratchDir, 'final.mp4'),
        deadline: hangDeadline('bundle'),
      });

    let firstCaught: unknown;
    try {
      await attempt();
    } catch (err) {
      firstCaught = err;
    }
    let secondCaught: unknown;
    try {
      await attempt();
    } catch (err) {
      secondCaught = err;
    }

    expect(firstCaught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((firstCaught as InstanceType<typeof RemotionFinishTimeoutError>).stage).toBe('bundle');
    expect(secondCaught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((secondCaught as InstanceType<typeof RemotionFinishTimeoutError>).stage).toBe('bundle');
    expect(bundleMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with a labeled timeout when selectComposition() hangs past the deadline', async () => {
    probeDurationSecMock.mockResolvedValue(4);
    bundleMock.mockResolvedValue('file:///fake-bundle');
    selectCompositionMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const clipPath = await makeFixtureClip();

    let caught: unknown;
    try {
      await renderStoryboardFinish({
        clipPaths: [clipPath],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(scratchDir, 'final.mp4'),
        deadline: hangDeadline('selectComposition'),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as InstanceType<typeof RemotionFinishTimeoutError>).stage).toBe('selectComposition');
    expect(renderMediaMock).not.toHaveBeenCalled();
  });

  it('rejects with a labeled timeout AND cancels the in-progress render when renderMedia() hangs past the deadline', async () => {
    probeDurationSecMock.mockResolvedValue(4);
    bundleMock.mockResolvedValue('file:///fake-bundle');
    selectCompositionMock.mockResolvedValue({ width: 1280, height: 720, fps: 30, durationInFrames: 60 });
    renderMediaMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const clipPath = await makeFixtureClip();

    let caught: unknown;
    try {
      await renderStoryboardFinish({
        clipPaths: [clipPath],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(scratchDir, 'final.mp4'),
        deadline: hangDeadline('renderMedia'),
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as InstanceType<typeof RemotionFinishTimeoutError>).stage).toBe('renderMedia');
    // The deadline expiring must actually trigger Remotion's own cancel
    // mechanism (makeCancelSignal's cancel()), not just abandon our await
    // of a still-running render — that's what stops Chrome/encoding from
    // being stranded in the background.
    expect(cancelMock).toHaveBeenCalled();
  });

  it('resolves normally when every stage finishes well within the deadline', async () => {
    probeDurationSecMock.mockResolvedValue(4);
    bundleMock.mockResolvedValue('file:///fake-bundle');
    selectCompositionMock.mockResolvedValue({ width: 1280, height: 720, fps: 30, durationInFrames: 60 });
    renderMediaMock.mockResolvedValue(undefined);
    const clipPath = await makeFixtureClip();

    await expect(
      renderStoryboardFinish({
        clipPaths: [clipPath],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(scratchDir, 'final.mp4'),
        deadline: createDeadline(30_000),
      }),
    ).resolves.toBeUndefined();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('memoizes bundle() across sequential renders — exactly one bundle() call for two successful renders', async () => {
    probeDurationSecMock.mockResolvedValue(4);
    bundleMock.mockResolvedValue('file:///fake-bundle');
    selectCompositionMock.mockResolvedValue({ width: 1280, height: 720, fps: 30, durationInFrames: 60 });
    renderMediaMock.mockResolvedValue(undefined);

    // Two independent scratch dirs (not the shared `scratchDir` var, which
    // only tracks one dir for the shared afterEach cleanup) so both renders
    // have distinct, real source files and output paths.
    const dirA = await mkdtemp(path.join(os.tmpdir(), 'od-render-deadline-test-'));
    const dirB = await mkdtemp(path.join(os.tmpdir(), 'od-render-deadline-test-'));
    try {
      const clipA = path.join(dirA, 'clip-0.mp4');
      const clipB = path.join(dirB, 'clip-0.mp4');
      await writeFile(clipA, Buffer.from('clip a'));
      await writeFile(clipB, Buffer.from('clip b'));

      await renderStoryboardFinish({
        clipPaths: [clipA],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(dirA, 'final.mp4'),
        deadline: createDeadline(30_000),
      });
      await renderStoryboardFinish({
        clipPaths: [clipB],
        titleEnabled: false,
        titleText: '',
        transitionsEnabled: true,
        audioPath: null,
        captions: null,
        ratio: '16:9',
        outputPath: path.join(dirB, 'final.mp4'),
        deadline: createDeadline(30_000),
      });

      expect(bundleMock).toHaveBeenCalledTimes(1);
      expect(selectCompositionMock).toHaveBeenCalledTimes(2);
      expect(renderMediaMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});
