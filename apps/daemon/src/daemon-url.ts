import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIDECAR_ENV,
  SIDECAR_MESSAGES,
  type DaemonStatusSnapshot,
} from "@open-design/sidecar-proto";
import { requestJsonIpc } from "@open-design/sidecar";

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:7456";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ResolveDaemonUrlOptions {
  /** Value passed via `--daemon-url`. Empty string is treated as unset. */
  flagUrl?: string | null;
  /** Defaults to `process.env`; injected for tests. */
  env?: NodeJS.ProcessEnv;
  /** IPC discovery timeout. Short by default so an absent daemon does not stall CLI startup. */
  timeoutMs?: number;
}

/**
 * What one discovery probe learned.
 *
 * - `url` — the probe found a live daemon.
 * - `null` url with no `inconclusive` reason — the probe ran to a conclusion
 *   and nothing was listening.
 * - `null` url WITH an `inconclusive` reason — the probe never finished (its
 *   budget ran out, or it failed for a reason other than "not there"), so it
 *   proves nothing either way.
 */
interface DaemonProbeResult {
  url: string | null;
  inconclusive?: string;
}

/**
 * Thrown when daemon discovery could not reach a conclusion.
 *
 * Callers get this instead of a silent `DEFAULT_DAEMON_URL`, so "no daemon
 * found" stays distinguishable from "discovery timed out".
 */
export class DaemonUrlDiscoveryError extends Error {
  /** One line per probe that could not finish, in probe order. */
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(
      `daemon discovery did not complete (${reasons.join("; ")}). ` +
        `Refusing to assume ${DEFAULT_DAEMON_URL}, which may belong to a different daemon. ` +
        `Pass --daemon-url <url> or set OD_DAEMON_URL to address a daemon explicitly.`,
    );
    this.name = "DaemonUrlDiscoveryError";
    this.reasons = reasons;
  }
}

/**
 * Resolve the daemon HTTP base URL for `od` client commands.
 *
 * Spawn order: explicit `--daemon-url` flag, `OD_DAEMON_URL` env, then
 * a STATUS roundtrip to the concrete sidecar IPC endpoint supplied by
 * the lifecycle owner in `OD_SIDECAR_IPC_PATH`, then the default
 * `tools-dev status --json` runtime. Falls back to the legacy default
 * for direct `od` launches that do not run as a sidecar — but only when
 * discovery reached a conclusion; see `defaultDaemonUrlOrFailClosed`.
 *
 * @throws DaemonUrlDiscoveryError when a discovery probe never finished.
 */
export async function resolveDaemonUrl(
  options: ResolveDaemonUrlOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const flagUrl = options.flagUrl ?? null;
  if (flagUrl != null && flagUrl.length > 0) return flagUrl;
  const envUrl = env.OD_DAEMON_URL;
  if (envUrl != null && envUrl.length > 0) return envUrl;
  const timeoutMs = options.timeoutMs ?? 800;
  const inconclusive: string[] = [];
  const discovered = await discoverDaemonUrlFromIpc(env, timeoutMs);
  if (discovered.url != null) return discovered.url;
  if (discovered.inconclusive != null) inconclusive.push(discovered.inconclusive);
  const toolsDev = await discoverDaemonUrlFromToolsDev(env, timeoutMs);
  if (toolsDev.url != null) return toolsDev.url;
  if (toolsDev.inconclusive != null) inconclusive.push(toolsDev.inconclusive);
  return defaultDaemonUrlOrFailClosed(inconclusive);
}

/**
 * The legacy default port is only safe once discovery has reached a
 * conclusion — every probe reported that nothing is listening. A probe that
 * ran out of budget or failed for an unexpected reason proves nothing: the
 * user's daemon may be alive on an ephemeral port while some OTHER daemon
 * holds {@link DEFAULT_DAEMON_URL}, and an `od` client pointed there would
 * mutate that daemon's project data.
 *
 * So the fallback is fail-closed: conclusive absence returns the documented
 * default, and an inconclusive discovery raises
 * {@link DaemonUrlDiscoveryError} carrying the reasons.
 */
function defaultDaemonUrlOrFailClosed(inconclusive: readonly string[]): string {
  if (inconclusive.length === 0) return DEFAULT_DAEMON_URL;
  throw new DaemonUrlDiscoveryError(inconclusive);
}

/**
 * Errno codes that mean "nothing is listening at this socket path". Any other
 * failure (a timeout, a protocol error) leaves the question open.
 */
const IPC_ABSENT_CODES = new Set(["ENOENT", "ECONNREFUSED", "ENOTSOCK", "EACCES"]);

async function discoverDaemonUrlFromIpc(
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<DaemonProbeResult> {
  const socketPath = env[SIDECAR_ENV.IPC_PATH];
  if (socketPath == null || socketPath.length === 0) return { url: null };
  try {
    const status = await requestJsonIpc<DaemonStatusSnapshot>(
      socketPath,
      { type: SIDECAR_MESSAGES.STATUS },
      { timeoutMs },
    );
    // A live sidecar that answers without a URL is a conclusive "not serving".
    return { url: status?.url ?? null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code != null && IPC_ABSENT_CODES.has(code)) return { url: null };
    const detail = error instanceof Error ? error.message : String(error);
    return { url: null, inconclusive: `sidecar IPC status probe did not answer: ${detail}` };
  }
}

async function discoverDaemonUrlFromToolsDev(
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<DaemonProbeResult> {
  return await new Promise<DaemonProbeResult>((resolve) => {
    let child;
    try {
      child = spawn("pnpm", ["--silent", "exec", "tools-dev", "status", "--json"], {
        cwd: REPO_ROOT,
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // `pnpm` is not launchable here — there is no tools-dev runtime to find.
      resolve({ url: null });
      return;
    }

    let settled = false;
    let stdout = "";
    const done = (result: DaemonProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      done({
        url: null,
        inconclusive: `tools-dev status probe exceeded its ${timeoutMs}ms budget`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", () => done({ url: null }));
    child.on("close", (code) => {
      done({ url: code === 0 ? extractDaemonUrlFromToolsDevStatus(stdout) : null });
    });
  });
}

function extractDaemonUrlFromToolsDevStatus(stdout: string): string | null {
  for (let i = stdout.indexOf("{"); i !== -1; i = stdout.indexOf("{", i + 1)) {
    try {
      const parsed = JSON.parse(stdout.slice(i)) as {
        apps?: { daemon?: { url?: string | null } };
        url?: string | null;
      };
      const url = parsed?.apps?.daemon?.url ?? parsed?.url ?? null;
      if (typeof url === "string" && url.length > 0) return url;
    } catch {
      // pnpm wrappers can print warnings before JSON; continue scanning.
    }
  }
  return null;
}
