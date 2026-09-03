import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { PreviewInfo } from '@open-design/contracts';

import { loopbackPreviewUrl } from './preview-origin.js';

/**
 * Daemon-owned preview server lifecycle (issue #38).
 *
 * Agent-started dev servers die with the agent's tool-call shell, and agents
 * were reporting preview URLs as live without anything verifying the socket.
 * This service makes the daemon the owner: it spawns the preview command in
 * its own process group, resolves start() ONLY once the port actually answers
 * HTTP, and tears down by signalling the whole group and confirming no
 * survivors before reporting success (the teardown discipline recorded in
 * docs/plans/waves/DECISIONS.md — a leader's exit event is not proof the
 * group exited).
 *
 * Sessions are process-local like terminal sessions: a daemon restart takes
 * the previews down with it, which is the honest behavior — there is no one
 * left to supervise them.
 */

const DEFAULT_READY_TIMEOUT_MS = 60_000;
const PROBE_INTERVAL_MS = 150;
const PROBE_REQUEST_TIMEOUT_MS = 1_000;
const STOP_GRACE_MS = 3_000;
const KILL_CONFIRM_MS = 2_000;
const LOG_TAIL_CAP = 16_384;

export type PreviewStartOptions = {
  projectId: string;
  cwd: string;
  command: string[];
  port: number;
  readyTimeoutMs?: number;
  /** Test hook: observe the spawned pid before the readiness gate resolves. */
  onSpawn?: (pid: number) => void;
};

export type { PreviewInfo };

export class PreviewLifecycleError extends Error {
  code: 'PREVIEW_EXITED' | 'PREVIEW_NOT_REACHABLE' | 'PREVIEW_SPAWN_FAILED' | 'PREVIEW_PORT_IN_USE';
  logs: string;

  constructor(code: PreviewLifecycleError['code'], message: string, logs: string) {
    super(message);
    this.code = code;
    this.logs = logs;
  }
}

type Session = PreviewInfo & { logsTail: () => string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type KillImpl = (pid: number, signal: NodeJS.Signals | 0) => void;

/**
 * True while ANY member of the process group is still alive. EPERM on the
 * group signal means the group EXISTS but holds a member we lack permission
 * to signal (e.g. a child that re-execed under another uid) — that is an
 * ALIVE group, never a confirmation of teardown. Only ESRCH-style failure
 * falls back to the leader check. Exported with an injectable kill for tests.
 */
export function groupAlive(pid: number, killImpl: KillImpl = process.kill.bind(process)): boolean {
  try {
    killImpl(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    try {
      killImpl(pid, 0);
      return true;
    } catch (leaderError) {
      if ((leaderError as NodeJS.ErrnoException).code === 'EPERM') return true;
      return false;
    }
  }
}

/**
 * Signal the whole group. EPERM means the group exists but we cannot signal
 * (at least one of) its members — falling back to a leader-only kill would
 * misreport delivery, so we stop there and let the confirmation loop surface
 * `confirmed: false`. Other failures (platforms without group kill) fall back
 * to the leader. Exported with an injectable kill for tests.
 */
export function signalGroup(
  pid: number,
  signal: NodeJS.Signals,
  killImpl: KillImpl = process.kill.bind(process),
): void {
  try {
    killImpl(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
    try {
      killImpl(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

/**
 * SIGTERM the group, wait out the grace period, escalate to SIGKILL, and
 * report whether the group is CONFIRMED gone. Callers must not report a
 * successful stop on `confirmed === false`.
 */
async function teardownGroup(pid: number): Promise<boolean> {
  signalGroup(pid, 'SIGTERM');
  const graceDeadline = Date.now() + STOP_GRACE_MS;
  while (groupAlive(pid) && Date.now() < graceDeadline) await sleep(100);
  if (groupAlive(pid)) {
    signalGroup(pid, 'SIGKILL');
    const killDeadline = Date.now() + KILL_CONFIRM_MS;
    while (groupAlive(pid) && Date.now() < killDeadline) await sleep(100);
  }
  return !groupAlive(pid);
}

export function createPreviewService() {
  const sessions = new Map<string, Session>();

  async function start(opts: PreviewStartOptions): Promise<PreviewInfo> {
    const { projectId, cwd, command, port } = opts;
    const readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const [bin, ...args] = command;
    if (!bin) throw new PreviewLifecycleError('PREVIEW_SPAWN_FAILED', 'empty command', '');

    // The readiness probe can only prove SOMETHING answers on the port, not
    // that it is our child — so refuse to start when the port is already
    // taken (a stale server, an unrelated service) instead of "verifying"
    // a stranger's socket and later killing the wrong expectation.
    await assertPortFree(port);

    const child = spawn(bin, args, {
      cwd,
      // Own process group: the daemon can tear down the full tree, and the
      // preview does not die with whatever shell asked for it.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    });

    let logs = '';
    const append = (chunk: Buffer | string) => {
      logs = (logs + String(chunk)).slice(-LOG_TAIL_CAP);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    const childState: { exited: boolean; exitCode: number | null; spawnError?: Error } = {
      exited: false,
      exitCode: null,
    };
    child.on('exit', (code) => {
      childState.exited = true;
      childState.exitCode = code;
    });
    child.on('error', (error) => {
      childState.exited = true;
      childState.spawnError = error;
    });

    const pid = child.pid ?? 0;
    if (pid) opts.onSpawn?.(pid);

    // The stored URL is the daemon machine's own address; the HTTP surface
    // re-announces it on the host each request arrived on.
    const url = loopbackPreviewUrl(port);
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (childState.exited) {
        throw new PreviewLifecycleError(
          childState.spawnError ? 'PREVIEW_SPAWN_FAILED' : 'PREVIEW_EXITED',
          childState.spawnError
            ? `preview command failed to spawn: ${childState.spawnError.message}`
            : `preview process exited with code ${childState.exitCode} before becoming reachable`,
          logs,
        );
      }
      try {
        // ANY HTTP response — including an error page — proves the port is
        // reachable from a browser. Ownership was established by the
        // port-free preflight above; the exited re-check below closes the
        // answered-then-crashed window.
        const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_REQUEST_TIMEOUT_MS) });
        if (res.body) await res.body.cancel().catch(() => {});
        if (childState.exited) {
          throw new PreviewLifecycleError(
            'PREVIEW_EXITED',
            `preview process exited with code ${childState.exitCode} right after answering`,
            logs,
          );
        }
        const session: Session = {
          id: randomUUID(),
          projectId,
          pid,
          port,
          url,
          command,
          cwd,
          startedAt: Date.now(),
          status: 'ready',
          logsTail: () => logs,
        };
        child.on('exit', () => sessions.delete(session.id));
        sessions.set(session.id, session);
        return info(session);
      } catch {
        // Not answering yet — keep polling until the deadline.
      }
      await sleep(PROBE_INTERVAL_MS);
    }

    // The readiness gate failed: never leak the child.
    if (pid) await teardownGroup(pid);
    throw new PreviewLifecycleError(
      'PREVIEW_NOT_REACHABLE',
      `nothing answered on ${url} within ${readyTimeoutMs}ms`,
      logs,
    );
  }

  function info(session: Session): PreviewInfo {
    const { logsTail: _logsTail, ...rest } = session;
    return rest;
  }

  function list(projectId?: string): PreviewInfo[] {
    const all = [...sessions.values()].map(info);
    return projectId ? all.filter((s) => s.projectId === projectId) : all;
  }

  function get(id: string): PreviewInfo | undefined {
    const session = sessions.get(id);
    return session ? info(session) : undefined;
  }

  async function stop(id: string): Promise<{ stopped: true; confirmed: boolean; pid: number }> {
    const session = sessions.get(id);
    if (!session) throw new Error(`unknown preview session: ${id}`);
    const confirmed = await teardownGroup(session.pid);
    // Keep an unconfirmed session addressable so the caller can retry stop()
    // (or find the pid) instead of orphaning a possibly-live group.
    if (confirmed) sessions.delete(id);
    return { stopped: true, confirmed, pid: session.pid };
  }

  async function shutdown(): Promise<void> {
    const ids = [...sessions.keys()];
    await Promise.all(ids.map((id) => stop(id).catch(() => {})));
  }

  return { start, list, get, stop, shutdown };
}

/** Reject start() when another process already owns the port. */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => {
      reject(new PreviewLifecycleError(
        'PREVIEW_PORT_IN_USE',
        `port ${port} is already in use — stop whatever is listening there or pick another port`,
        '',
      ));
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve());
    });
  });
}

/**
 * Confine a preview working directory to the project's own tree. Purely
 * lexical checks are not enough — a symlink inside the project can point
 * outside it — so both sides are canonicalized through realpath before the
 * containment comparison (matching the repo-wide pattern in
 * chat-prompt-inputs.ts / projects.ts). A cwd that does not exist is
 * rejected: previews can only run somewhere real.
 */
export function confinePreviewCwd(baseDir: string, requestedCwd?: string): string | null {
  let realBase: string;
  try {
    realBase = fs.realpathSync(baseDir);
  } catch {
    return null;
  }
  if (!requestedCwd) return realBase;
  const resolved = path.resolve(realBase, requestedCwd);
  let realResolved: string;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    return null;
  }
  if (realResolved !== realBase && !realResolved.startsWith(`${realBase}${path.sep}`)) return null;
  return realResolved;
}
