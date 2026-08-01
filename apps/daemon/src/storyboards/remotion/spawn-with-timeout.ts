// Shared spawn wrapper for the Remotion finishing pass's ffprobe/ffmpeg
// child processes (review finding T1) — every process this pipeline spawns
// must be boundable and, on expiry, actually KILLED rather than merely
// abandoned (an abandoned ffmpeg process keeps burning CPU/holding file
// handles even after the HTTP request has already failed).

import { spawn } from 'node:child_process';
import { RemotionFinishTimeoutError } from './deadline.js';

export interface SpawnWithTimeoutResult {
  stdout: string;
  stderr: string;
}

// If SIGTERM doesn't end the process promptly, escalate to SIGKILL rather
// than waiting indefinitely for a process that may be ignoring SIGTERM.
const KILL_ESCALATION_MS = 2000;

/**
 * Runs `command args` to completion, collecting stdout/stderr. Sends
 * SIGTERM (escalating to SIGKILL after KILL_ESCALATION_MS) if the process
 * hasn't exited within `timeoutMs`, and rejects with a
 * RemotionFinishTimeoutError labeled `stage` in that case.
 */
export function spawnWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  stage: string,
): Promise<SpawnWithTimeoutResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const termTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(0, timeoutMs));
    termTimer.unref?.();

    const killTimer = setTimeout(
      () => {
        if (!settled) child.kill('SIGKILL');
      },
      Math.max(0, timeoutMs) + KILL_ESCALATION_MS,
    );
    killTimer.unref?.();

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      fn();
    };

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err?.code === 'ENOENT') {
          reject(Object.assign(new Error(`${command}-not-found`), { code: 'ENOENT' }));
          return;
        }
        reject(err);
      });
    });
    child.on('close', (code) => {
      settle(() => {
        if (timedOut) {
          reject(new RemotionFinishTimeoutError(stage));
          return;
        }
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        }
      });
    });
  });
}
