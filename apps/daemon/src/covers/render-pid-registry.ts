// Orphan reaper for the renderer's browser process (S4-2 -- security-review
// finding 6). renderer.ts's per-job cleanup (server.kill() in its own
// `finally`) is correct for every ordinary exit path, but a daemon process
// SIGKILL'd between chromium.launchServer() succeeding and that `finally`
// running leaves an orphaned Chromium tree behind with nothing to reap it:
// the browser server has no parent-death signal wired up, so it survives
// the daemon and never terminates on its own. Every render job registers
// its browser PID here before starting work and unregisters it in its own
// `finally`; on the NEXT daemon startup, sweepOrphanedRenderProcesses kills
// anything left registered from a process that no longer exists.
//
// PID reuse safety: a marker alone is not enough to justify a kill -- the
// OS can and does reuse a pid number after the original process exits, so
// blindly SIGKILLing whatever now holds that pid could kill an unrelated,
// live process. Before killing, this module re-checks the CURRENT
// process's own command line (via `ps`) for a shape that could only be
// this renderer's own headless Chromium invocation (see
// looksLikeOwnHeadlessChromium below); anything else is left alone even if
// its pid matches a stale marker.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function pidRegistryDir(runtimeDataDir: string): string {
  return path.join(runtimeDataDir, 'covers', '.render-pids');
}

function pidMarkerPath(runtimeDataDir: string, pid: number): string {
  return path.join(pidRegistryDir(runtimeDataDir), `${pid}.json`);
}

export async function registerRenderPid(runtimeDataDir: string, pid: number): Promise<void> {
  try {
    const dir = pidRegistryDir(runtimeDataDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(pidMarkerPath(runtimeDataDir, pid), JSON.stringify({ pid, registeredAt: Date.now() }));
  } catch {
    // Best-effort: a failure to register must never block a render job --
    // it only means the startup sweep has one fewer marker to reap from
    // if THIS process dies mid-job, not a correctness issue for the job.
  }
}

export async function unregisterRenderPid(runtimeDataDir: string, pid: number): Promise<void> {
  await fs.rm(pidMarkerPath(runtimeDataDir, pid), { force: true }).catch(() => undefined);
}

/** True only for a command line that could exclusively be this module's
 * own headless-Chromium render invocation -- guards the sweep against
 * killing an unrelated process that happens to have reused a stale pid. */
function looksLikeOwnHeadlessChromium(commandLine: string): boolean {
  return commandLine.includes('--headless') && /playwright|ms-playwright|chromium/i.test(commandLine);
}

async function processCommandLine(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null; // no such pid -- already gone, nothing to reap
  }
}

/**
 * Runs once at daemon startup, before this process registers any render
 * PID of its own. Reads every marker left behind (necessarily by a PRIOR
 * daemon process, since this one has not rendered anything yet), and for
 * each one still holding a live, recognizably-our-own headless Chromium
 * process, kills the whole tree. Always removes the marker file
 * regardless of outcome so a permanently-gone pid does not get re-checked
 * on every future startup.
 */
export async function sweepOrphanedRenderProcesses(runtimeDataDir: string): Promise<void> {
  const dir = pidRegistryDir(runtimeDataDir);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return; // no registry yet -- nothing to sweep
  }
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const markerPath = path.join(dir, name);
        const pid = Number(name.replace(/\.json$/, ''));
        try {
          if (Number.isInteger(pid) && pid > 0) {
            const commandLine = await processCommandLine(pid);
            if (commandLine && looksLikeOwnHeadlessChromium(commandLine)) {
              try {
                process.kill(-pid, 'SIGKILL'); // process group first (launchServer's default group leader)
              } catch {
                try {
                  process.kill(pid, 'SIGKILL');
                } catch {
                  /* already gone */
                }
              }
            }
          }
        } finally {
          await fs.rm(markerPath, { force: true }).catch(() => undefined);
        }
      }),
  );
}
