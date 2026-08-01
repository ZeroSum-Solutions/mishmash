// Fast, hermetic tests for spawnWithTimeout (review finding T1) — every
// process the Remotion finishing pass spawns (ffprobe, ffmpeg) must be
// boundable and actually KILLED on expiry, not merely abandoned. Uses real
// child processes (a genuinely never-exiting one) but with tiny
// millisecond-scale timeouts — never a real long wait.

import { describe, expect, it } from 'vitest';
import { RemotionFinishTimeoutError } from '../../src/storyboards/remotion/deadline.js';
import { spawnWithTimeout } from '../../src/storyboards/remotion/spawn-with-timeout.js';

describe('spawnWithTimeout', () => {
  it('kills a never-exiting process and rejects with a labeled RemotionFinishTimeoutError', async () => {
    const start = Date.now();
    let caught: unknown;
    try {
      // A real child that never exits on its own (setInterval keeps the
      // event loop alive forever) — if spawnWithTimeout only abandoned the
      // promise instead of actually killing it, this test would hang past
      // vitest's own test timeout instead of settling quickly.
      await spawnWithTimeout('node', ['-e', 'setInterval(() => {}, 1000)'], 150, 'test-stage');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as RemotionFinishTimeoutError).stage).toBe('test-stage');
    expect((caught as RemotionFinishTimeoutError).code).toBe('REMOTION_FINISH_TIMEOUT');
    // Proves it actually settled promptly (i.e. the process was really
    // killed), not merely that the assertion above happens to be true.
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('resolves normally when the command finishes well within the timeout', async () => {
    const { stdout } = await spawnWithTimeout('node', ['-e', 'process.stdout.write("ok")'], 5000, 'test-stage');
    expect(stdout).toBe('ok');
  });

  it('rejects with the exit code/stderr on a real (non-timeout) failure', async () => {
    let caught: unknown;
    try {
      await spawnWithTimeout('node', ['-e', 'process.stderr.write("boom"); process.exit(1);'], 5000, 'test-stage');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as Error).message).toContain('boom');
  });

  it('surfaces a labeled ENOENT-style error for a missing command, not a timeout', async () => {
    let caught: unknown;
    try {
      // An absolute path (rather than a bare command name) reliably yields
      // ENOENT from spawn() — a bare nonexistent name can surface as EACCES
      // instead on some platforms' PATH-search fallback, which isn't what
      // this test is pinning.
      await spawnWithTimeout('/definitely/does/not/exist/od-nonexistent-binary-xyz', [], 1000, 'test-stage');
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(RemotionFinishTimeoutError);
    expect((caught as NodeJS.ErrnoException)?.code).toBe('ENOENT');
  });
});
