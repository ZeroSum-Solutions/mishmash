import { spawn } from 'node:child_process';
import os from 'node:os';
import { createCommandInvocation } from '@open-design/platform';
import type { RuntimeExecOptions } from './types.js';

export interface AgentExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Rejection shape of a failed probe.
 *
 * Callers discriminate on `code`: a string is an OS-level spawn rejection
 * (`ENOENT`, `EACCES`, `ENOTDIR`) and a number is a real non-zero exit status.
 * `stdout` / `stderr` carry whatever the child produced before it failed, and
 * `killed` marks a child this module stopped rather than one that exited on
 * its own. This mirrors what `util.promisify(execFile)` attached, which is
 * what `runtimes/detection.ts` and `runtimes/auth.ts` read.
 */
export interface AgentExecError extends Omit<NodeJS.ErrnoException, 'code'> {
  code?: string | number;
  signal?: NodeJS.Signals | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

const DEFAULT_PROBE_MAX_BUFFER = 1024 * 1024;

// Grace between the polite stop and the unconditional one. Long enough for a
// well-behaved CLI to flush and exit on SIGTERM, short enough that a stuck
// probe cannot hold a detection's wall-clock budget open.
const PROBE_KILL_ESCALATION_MS = 250;

/**
 * Stop one probe subprocess and everything it started.
 *
 * INVARIANT: no probe child, and no descendant it spawned, outlives the budget
 * its caller gave it. The child is spawned `detached`, which makes it the
 * leader of its own process group, so signalling the negated pid reaches the
 * whole group. SIGTERM asks first; SIGKILL follows after a short grace, which
 * is what catches a CLI that traps or ignores SIGTERM.
 *
 * `child_process.execFile`'s own `timeout` gives neither: it sends a single
 * SIGTERM to the direct child, so a CLI that ignores it — or a wrapper whose
 * real worker is a grandchild — keeps running and the exec call never settles.
 * 29 orphaned `cursor-agent` probes accumulated that way and tripped the
 * fan-out guard (item B-22).
 *
 * Windows has no POSIX process groups; there the escalation still runs but
 * reaches the direct child only.
 */
function terminateProbeTree(pid: number | undefined): void {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;
  const targets = process.platform === 'win32' ? [pid] : [-pid, pid];
  const signal = (target: number, name: NodeJS.Signals): boolean => {
    try {
      process.kill(target, name);
      return true;
    } catch {
      return false;
    }
  };
  const reached = targets.filter((target) => signal(target, 'SIGTERM'));
  if (reached.length === 0) return;
  const escalation = setTimeout(() => {
    for (const target of reached) signal(target, 'SIGKILL');
  }, PROBE_KILL_ESCALATION_MS);
  escalation.unref();
}

// Agent probes (model-list / version / help / auth-status) are short read-only
// metadata calls that never need the caller's project files. Default them to a
// neutral working directory instead of inheriting the daemon process cwd.
//
// This matters because some agent CLIs are bun-based (OpenCode) and run a
// `bun install` on startup in their cwd to set up local plugins. When the daemon
// is launched from a pnpm workspace (e.g. a dev checkout), inheriting that cwd
// let an `opencode models` probe drop a workspace `bun.lock` + `node_modules/.bun`
// over the repo, wiping its pnpm store and breaking `next dev`. A probe writing a
// stray lockfile under the OS temp dir is harmless. Actual agent runs spawn
// elsewhere with an explicit project cwd and are unaffected.
//
// The child is spawned rather than `execFile`d because `execFile` does not
// forward `detached` to `spawn`, and without its own process group a timed-out
// probe cannot be killed as a tree — see `terminateProbeTree`.
export function execAgentFile(
  command: string,
  args: string[],
  options: RuntimeExecOptions = {},
): Promise<AgentExecResult> {
  const invocation = createCommandInvocation(
    options.env
      ? {
          command,
          args,
          env: options.env,
        }
      : {
          command,
          args,
        },
  );
  const maxBuffer = typeof options.maxBuffer === 'number' && options.maxBuffer > 0
    ? options.maxBuffer
    : DEFAULT_PROBE_MAX_BUFFER;
  const { timeout } = options;

  return new Promise<AgentExecResult>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd ?? os.tmpdir(),
      ...(options.env ? { env: options.env } : {}),
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      // Own process group, so a timeout can reach grandchildren too.
      detached: process.platform !== 'win32',
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let overflowed = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      if (deadline) clearTimeout(deadline);
      deadline = undefined;
    };

    const capture = (
      stream: NodeJS.ReadableStream | null,
      append: (chunk: string) => void,
    ) => {
      if (!stream) return;
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => append(chunk));
    };

    capture(child.stdout, (chunk) => {
      if (stdout.length + chunk.length > maxBuffer) {
        overflowed = true;
        terminateProbeTree(child.pid);
        return;
      }
      stdout += chunk;
    });
    capture(child.stderr, (chunk) => {
      if (stderr.length + chunk.length > maxBuffer) {
        overflowed = true;
        terminateProbeTree(child.pid);
        return;
      }
      stderr += chunk;
    });

    const fail = (error: AgentExecError) => {
      if (settled) return;
      settled = true;
      stop();
      error.stdout = stdout;
      error.stderr = stderr;
      if (timedOut) error.killed = true;
      reject(error);
    };

    child.on('error', (error) => fail(error as AgentExecError));

    child.on('close', (code, signal) => {
      if (settled) return;
      if (code === 0 && !timedOut && !overflowed) {
        settled = true;
        stop();
        resolve({ stdout, stderr });
        return;
      }
      const reason = timedOut
        ? `timed out after ${String(timeout)}ms`
        : overflowed
          ? `produced more than ${String(maxBuffer)} bytes of output`
          : `exited with code ${String(code)}`;
      const error: AgentExecError = new Error(
        `Command failed: ${invocation.command} ${invocation.args.join(' ')} (${reason})\n${stderr}`,
      );
      if (typeof code === 'number') error.code = code;
      if (signal) error.signal = signal;
      fail(error);
    });

    if (typeof timeout === 'number' && timeout > 0) {
      deadline = setTimeout(() => {
        timedOut = true;
        terminateProbeTree(child.pid);
      }, timeout);
      deadline.unref();
    }
  });
}
