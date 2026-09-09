#!/usr/bin/env node
// Frozen first-party stand-in for ffmpeg AND ffprobe, used ONLY by
// apps/daemon/tests/media/jobs.test.ts (INV-7.13 F-04 fixture). Never
// shipped, never installed on a real PATH. Deterministic: the same
// -progress line sequence, the same sleep, and the same output bytes every
// run, so the test's SHA-256 comparison is stable across machines and CI.
//
// Two roles, selected by argv shape, matching how apps/daemon/src/media/jobs.ts
// is expected to invoke a real ffprobe/ffmpeg pair (test-only override env
// vars OD_MEDIA_JOB_FFMPEG_BIN / OD_MEDIA_JOB_FFPROBE_BIN point both at this
// same script):
//
//   - probe mode (argv includes `-show_entries`): prints the frozen fixture
//     duration (5.000000 seconds) to stdout and exits 0.
//   - encode mode (argv includes `-progress`): writes 5 `out_time_ms=…`/
//     `progress=…` line pairs to stdout, 400ms apart (2000ms total wall
//     time), then writes FIXTURE_OUTPUT_BYTES to the last positional
//     argument (the output path) and exits 0.
//
// SIGTERM during encode mode: writes a kill-receipt marker file
// (`<output>.killed`, containing the receipt timestamp) before exiting —
// proof the signal reached the child, not just that the parent gave up
// waiting — and never writes the output file.
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const isProbe = argv.includes('-show_entries');

if (isProbe) {
  process.stdout.write('5.000000\n');
  process.exit(0);
}

const output = argv[argv.length - 1];

// Keep in sync with fake-ffmpeg-output.sha256 in this directory — if this
// literal changes, recompute and recommit that file too.
export const FIXTURE_OUTPUT_TEXT = `w7c-fake-ffmpeg-output-v1:${'x'.repeat(256)}`;
const FIXTURE_OUTPUT_BYTES = Buffer.from(FIXTURE_OUTPUT_TEXT, 'utf8');

// out_time_ms values a real ffmpeg -progress stream reports; STEP_MS is the
// wall-clock cadence between them (frozen at 400ms so the whole encode
// takes 2000ms of real time — long enough that a test-tuned
// OD_MEDIA_JOB_MAX_DURATION_MS of a few hundred ms reliably overshoots it).
const OUT_TIME_MS_STEPS = [1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000];
const STEP_MS = 400;

let killed = false;
process.on('SIGTERM', () => {
  killed = true;
  try {
    writeFileSync(`${output}.killed`, String(Date.now()));
  } catch {
    // Best effort — the test only needs the marker to exist, not this to succeed.
  }
  process.exit(143);
});

let i = 0;
const timer = setInterval(() => {
  if (killed) return;
  const outTimeMs = OUT_TIME_MS_STEPS[i];
  process.stdout.write(`out_time_ms=${outTimeMs}\n`);
  process.stdout.write(`progress=${i === OUT_TIME_MS_STEPS.length - 1 ? 'end' : 'continue'}\n`);
  i += 1;
  if (i >= OUT_TIME_MS_STEPS.length) {
    clearInterval(timer);
    if (!killed) {
      writeFileSync(output, FIXTURE_OUTPUT_BYTES);
      process.exit(0);
    }
  }
}, STEP_MS);
