#!/usr/bin/env node
// Test-only fixture (W7C jobs.test.ts "(b2)"/"(d2)"): stands in for a
// ffprobe that never exits on its own — the case fake-ffmpeg.mjs's probe
// mode (which always answers instantly) cannot exercise. Proves that
// runFfmpegEncodeChild's duration limit and cancel both reach the PROBE
// phase (INV-7.6/7.14), not only the encode phase, and that ffmpeg is
// never spawned when the probe itself is what gets killed.
//
// SIGTERM writes a kill-receipt marker (argv[2] + '.killed') before
// exiting, mirroring fake-ffmpeg.mjs's receipt convention, so the test can
// prove the signal actually reached this child process (group).
import { writeFileSync } from 'node:fs';

const receiptPath = process.argv[2];

process.on('SIGTERM', () => {
  if (receiptPath) {
    try {
      writeFileSync(`${receiptPath}.killed`, String(Date.now()));
    } catch {
      // Best effort — the test only needs the marker to exist, not this to succeed.
    }
  }
  process.exit(143);
});

// Never resolves on its own — every test using this fixture kills it via
// the duration limit or a cancel.
setInterval(() => {}, 60_000);
