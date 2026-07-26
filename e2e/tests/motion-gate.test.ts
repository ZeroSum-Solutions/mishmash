// @vitest-environment node

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';
import { afterEach, describe, expect, test } from 'vitest';

import { T } from '@/timeouts';
import { GOOD_FIXTURE_HTML, JANKY_FIXTURE_HTML } from '../resources/motion-gate-fixtures.js';

// -----------------------------------------------------------------------------
// Motion verification gate
//
// Screenshot diffing (skills/web-clone/scripts/visual-diff.mjs) proves two
// *static* renders match pixel-for-pixel, but it cannot prove a scroll
// animation stays smooth while it runs — a page can screenshot perfectly at
// five checkpoints and still stutter violently between them. This gate loads
// a fixture page in a real Chromium instance, drives a continuous scroll
// gesture with genuine wheel input (not `window.scrollTo()`), and measures
// the browser's own frame timing and Long Tasks signal while it runs.
//
// Two signals are combined, deliberately not a single average-FPS number (an
// average hides a single 400ms stall behind dozens of fine frames):
//   1. Inter-frame gaps from a self-chaining requestAnimationFrame loop.
//   2. The native Long Tasks API (`PerformanceObserver({ entryTypes:
//      ['longtask'] })`) — Chromium's own long-running-main-thread-task
//      signal, the same primitive Web Vitals/TBT tooling is built on.
// -----------------------------------------------------------------------------

// Fixture markup is imported as strings from `e2e/resources/`, not kept as loose
// `.html` files: `scripts/guard.ts` requires every file under `e2e/tests/` to be a
// `*.test.ts` and every file under `e2e/resources/` to be a flat `*.ts`, so there
// is nowhere in this package for a `.html` fixture to live.
// The fixtures are written to a temp dir and loaded over `file://` rather than
// injected with `page.setContent()`: `addInitScript` does not apply to
// setContent, so the frame recorder would never install and `window.__motion`
// would be undefined by the time metrics are read.
const FIXTURE_DIR = mkdtempSync(path.join(tmpdir(), 'motion-gate-'));
const FIXTURE_PATHS: Record<string, string> = {};
for (const [name, html] of Object.entries({ good: GOOD_FIXTURE_HTML, janky: JANKY_FIXTURE_HTML })) {
  const file = path.join(FIXTURE_DIR, `${name}.html`);
  writeFileSync(file, html, 'utf8');
  FIXTURE_PATHS[name] = file;
}

// --- Frame-timing thresholds -------------------------------------------------

// A gap between two animation frames longer than this is a "long frame":
// >50ms of blocked main-thread time is the standard Long-Tasks-API /
// RAIL-guidance threshold at which users start to perceive lag, and is
// exactly the cutoff Chromium's native `longtask` PerformanceObserver entry
// type uses.
const LONG_FRAME_GAP_MS = 50;

// A gap longer than 2x the ~16.67ms budget of one frame at 60Hz means at
// least one whole frame was skipped relative to a smooth 60fps cadence.
const DROPPED_FRAME_GAP_MS = 33.4;

// Ceilings below are calibrated against repeated headless runs of both
// fixtures on this machine: the good fixture recorded exactly 0 long frames,
// 0 dropped frames, and 0 long tasks in every run; the janky fixture
// recorded 4-15 long frames, 23-24 dropped frames, and 21-22 long tasks
// totalling 1109-1428ms. These ceilings sit far below the janky fixture's
// measured numbers and give slack only for incidental CI-machine noise
// around the good fixture's true (measured) value of zero — they are not
// tuned toward the janky fixture's numbers.
const MAX_LONG_FRAMES = 2;
const MAX_DROPPED_FRAMES = 6;
const MAX_LONG_TASKS = 3;
const MAX_LONG_TASK_TOTAL_MS = 200;

// --- Scroll-drive constants ---------------------------------------------------

const SCROLL_STEPS = 120; // discrete wheel dispatches spanning the full scrollable height
const SCROLL_STEP_DELAY_MS = 8; // gap between wheel dispatches so events aren't coalesced into one
const SETTLE_MS = 300; // time to let the final frame's work finish before reading metrics
const CHECKPOINTS = [0, 0.25, 0.5, 0.75, 1] as const;

// Frame-gap metrics are wall-clock rAF scheduling measurements, so unlike the
// Long Tasks numbers (tied to actual JS execution time) they are also
// sensitive to *host* CPU contention having nothing to do with the fixture's
// own code — measured directly on this machine: 5 consecutive single-sample
// runs of this gate were clean (good = 0/0/0/0), but one run captured under
// an observed host load average of 30+ (unrelated concurrent processes)
// spuriously pushed the good fixture's frame-gap counts up (longFrameCount
// 5, droppedFrameCount 6) while its Long Tasks numbers stayed exactly 0.
// Taking the median of a fixed, upfront number of independent samples (not a
// retry-until-green loop — both fixtures always run exactly this many times)
// filters that host-noise outlier without touching the threshold values.
const MEASUREMENT_REPEATS = 3;

interface MotionState {
  frameGaps: number[];
  frameCount: number;
  longTasks: Array<{ start: number; duration: number }>;
  longTaskError?: string;
}

interface ScrollCapture {
  target: number;
  scrollY: number;
}

interface MotionMetrics {
  frameCount: number;
  maxGapMs: number;
  longFrameCount: number;
  droppedFrameCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  captures: ScrollCapture[];
}

interface GateResult {
  pass: boolean;
  reasons: string[];
}

/**
 * Runs inside the page via `addInitScript`, so it is active before the
 * fixture's own scripts run and can observe the very first frame.
 */
function installMotionRecorder(): void {
  const state: MotionState = { frameGaps: [], frameCount: 0, longTasks: [] };
  (window as unknown as { __motion: MotionState }).__motion = state;

  let last = performance.now();
  function tick(now: number): void {
    state.frameGaps.push(now - last);
    last = now;
    state.frameCount += 1;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch (error) {
    state.longTaskError = String(error);
  }
}

async function driveScrollAndMeasure(page: Page, fixtureName: string): Promise<MotionMetrics> {
  await page.addInitScript(installMotionRecorder);
  const file = FIXTURE_PATHS[fixtureName];
  if (file === undefined) {
    throw new Error(`unknown motion-gate fixture: ${fixtureName}`);
  }
  await page.goto(`file://${file}`, { waitUntil: 'load' });
  await page.waitForTimeout(200);

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const perStep = scrollHeight / SCROLL_STEPS;
  const captures: ScrollCapture[] = [];
  let nextCheckpoint = 0;

  for (let i = 0; i < SCROLL_STEPS; i += 1) {
    // Real input: a genuine wheel event through Chromium's actual
    // input/scroll pipeline, not a programmatic `scrollTo()` call.
    await page.mouse.wheel(0, perStep);
    await page.waitForTimeout(SCROLL_STEP_DELAY_MS);

    const progress = i / (SCROLL_STEPS - 1);
    const target = CHECKPOINTS[nextCheckpoint];
    if (target !== undefined && progress >= target) {
      const scrollY = await page.evaluate(() => window.scrollY);
      captures.push({ target, scrollY });
      nextCheckpoint += 1;
    }
  }
  await page.waitForTimeout(SETTLE_MS);

  const state = await page.evaluate(() => (window as unknown as { __motion: MotionState }).__motion);

  const gaps = state.frameGaps.slice(1); // drop the first tick (rAF startup, not animation)
  const longFrameCount = gaps.filter((gap) => gap > LONG_FRAME_GAP_MS).length;
  const droppedFrameCount = gaps.filter((gap) => gap > DROPPED_FRAME_GAP_MS).length;
  const maxGapMs = gaps.reduce((max, gap) => Math.max(max, gap), 0);
  const longTaskTotalMs = state.longTasks.reduce((total, entry) => total + entry.duration, 0);

  return {
    frameCount: state.frameCount,
    maxGapMs: Math.round(maxGapMs * 10) / 10,
    longFrameCount,
    droppedFrameCount,
    longTaskCount: state.longTasks.length,
    longTaskTotalMs: Math.round(longTaskTotalMs * 10) / 10,
    captures,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid];
  if (midValue === undefined) {
    return 0;
  }
  if (sorted.length % 2 === 0) {
    const lowerMidValue = sorted[mid - 1];
    return lowerMidValue === undefined ? midValue : (lowerMidValue + midValue) / 2;
  }
  return midValue;
}

function medianMetrics(samples: MotionMetrics[]): MotionMetrics {
  const last = samples[samples.length - 1];
  if (last === undefined) {
    throw new Error('medianMetrics requires at least one sample');
  }
  return {
    frameCount: Math.round(median(samples.map((s) => s.frameCount))),
    maxGapMs: median(samples.map((s) => s.maxGapMs)),
    longFrameCount: Math.round(median(samples.map((s) => s.longFrameCount))),
    droppedFrameCount: Math.round(median(samples.map((s) => s.droppedFrameCount))),
    longTaskCount: Math.round(median(samples.map((s) => s.longTaskCount))),
    longTaskTotalMs: median(samples.map((s) => s.longTaskTotalMs)),
    captures: last.captures,
  };
}

function evaluateMotionGate(metrics: MotionMetrics): GateResult {
  const reasons: string[] = [];
  if (metrics.longFrameCount > MAX_LONG_FRAMES) {
    reasons.push(`longFrameCount ${metrics.longFrameCount} > ${MAX_LONG_FRAMES}`);
  }
  if (metrics.droppedFrameCount > MAX_DROPPED_FRAMES) {
    reasons.push(`droppedFrameCount ${metrics.droppedFrameCount} > ${MAX_DROPPED_FRAMES}`);
  }
  if (metrics.longTaskCount > MAX_LONG_TASKS) {
    reasons.push(`longTaskCount ${metrics.longTaskCount} > ${MAX_LONG_TASKS}`);
  }
  if (metrics.longTaskTotalMs > MAX_LONG_TASK_TOTAL_MS) {
    reasons.push(`longTaskTotalMs ${metrics.longTaskTotalMs} > ${MAX_LONG_TASK_TOTAL_MS}`);
  }
  return { pass: reasons.length === 0, reasons };
}

describe('motion verification gate', () => {
  let browser: Browser | null = null;

  afterEach(async () => {
    await browser?.close();
    browser = null;
  });

  test(
    'passes a compositor-only scroll animation and fails a page with forced layout thrashing on scroll — asserted in one run',
    async () => {
      browser = await chromium.launch();

      const goodSamples: MotionMetrics[] = [];
      const jankySamples: MotionMetrics[] = [];
      for (let i = 0; i < MEASUREMENT_REPEATS; i += 1) {
        const goodPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        goodSamples.push(await driveScrollAndMeasure(goodPage, 'good'));
        await goodPage.close();

        const jankyPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        jankySamples.push(await driveScrollAndMeasure(jankyPage, 'janky'));
        await jankyPage.close();
      }

      const good = medianMetrics(goodSamples);
      const janky = medianMetrics(jankySamples);

      // Surfaced so the measured numbers are visible in test output, not
      // just the pass/fail booleans asserted below: every raw sample plus
      // the median used for the gate decision.
      console.log('[motion-gate] good  samples', JSON.stringify(goodSamples));
      console.log('[motion-gate] janky samples', JSON.stringify(jankySamples));
      console.log('[motion-gate] good  median ', JSON.stringify(good));
      console.log('[motion-gate] janky median ', JSON.stringify(janky));

      const goodResult = evaluateMotionGate(good);
      const jankyResult = evaluateMotionGate(janky);

      expect(
        goodResult.pass,
        `expected the smooth fixture to pass the motion gate; it failed because: ${goodResult.reasons.join('; ') || 'n/a'}`,
      ).toBe(true);

      expect(
        jankyResult.pass,
        'expected the janky fixture to FAIL the motion gate (it passed instead — either the fixture no longer reproduces real jank, or the thresholds have been loosened)',
      ).toBe(false);

      // Sanity check the harness itself actually swept the page top to bottom
      // for both fixtures, so a pass/fail result can't come from a scroll
      // that silently never happened.
      expect(good.captures[0]?.target).toBe(0);
      expect(good.captures.at(-1)?.target).toBe(1);
      expect(janky.captures[0]?.target).toBe(0);
      expect(janky.captures.at(-1)?.target).toBe(1);
    },
    // MEASUREMENT_REPEATS samples per fixture (2 fixtures) means this test
    // drives a full scroll gesture 2 * MEASUREMENT_REPEATS times; T.xlong
    // alone isn't enough headroom for that on a loaded CI machine.
    T.xlong * MEASUREMENT_REPEATS,
  );
});
