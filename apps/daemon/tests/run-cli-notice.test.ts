// W7B / INV-7.15 (wave 7, spec-audit-r2, W7-R2-16 — binding): "A following
// `od run` command writes every SSE frame, including terminal status, as
// unchanged ND-JSON on stdout; on `end`, stderr receives exactly one
// `Run finished: <status>` line, prefixed with BEL only when stderr is a
// TTY and `--json` is false."
//
// This file pins `completionNotice`'s pure contract directly, including
// the interactive-TTY BEL case an `execFile`-spawned child can never
// exercise for real (its stderr is always piped, never a TTY). Per
// W7-R2-17 (a missing-import failure is never the red), this file's first
// run fails only because `../src/cli-run-notice` does not exist yet on
// base — say so, and do not call that failure this track's red proof. The
// actual behavioural red is the stderr assertion added to
// `run-cli.test.ts` ("writes exactly one non-TTY stderr completion notice
// while stdout ND-JSON stays unchanged"), which imports nothing new and
// fails on base because `streamRunEvents` writes nothing to stderr today.
import { describe, expect, it } from 'vitest';

import { completionNotice } from '../src/cli-run-notice';

describe('completionNotice (pure helper, INV-7.15)', () => {
  it('writes the notice with a BEL prefix only on an interactive stderr TTY with --json false', () => {
    expect(completionNotice({ isTTY: true, json: false, status: 'succeeded' })).toBe(
      'Run finished: succeeded\n',
    );
  });

  it('omits the BEL when stderr is not a TTY, even with --json false', () => {
    expect(completionNotice({ isTTY: false, json: false, status: 'succeeded' })).toBe(
      'Run finished: succeeded\n',
    );
  });

  it('omits the BEL under --json even on an interactive TTY — same line, never a different message', () => {
    expect(completionNotice({ isTTY: true, json: true, status: 'succeeded' })).toBe(
      'Run finished: succeeded\n',
    );
  });

  it('reports the status verbatim, including a failed run', () => {
    expect(completionNotice({ isTTY: false, json: false, status: 'failed' })).toBe(
      'Run finished: failed\n',
    );
  });
});
