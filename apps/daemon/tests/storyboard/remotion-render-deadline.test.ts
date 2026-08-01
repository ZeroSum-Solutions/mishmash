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
        deadline: createDeadline(80),
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
        deadline: createDeadline(80),
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
        deadline: createDeadline(80),
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
        deadline: createDeadline(80),
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
