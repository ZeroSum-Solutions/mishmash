import { ACTOR_HEADER_NAME, normalizeActorName } from '@open-design/contracts';

const ACTOR_FLAG = '--actor';

/** Hosts that are always the local daemon, whatever discovery decided. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface ResolveCliActorOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedCliActor {
  actorName: string | null;
  /** argv with `--actor <name>` / `--actor=<name>` removed. */
  argv: string[];
}

/**
 * Resolves who is running `od`: `--actor <name>` first, then `OD_ACTOR`.
 *
 * INVARIANT: `--actor` is a GLOBAL option consumed here, at the entry point,
 * and stripped from the returned argv. Every subcommand's `parseFlags` refuses
 * an option it does not declare (`cli-args.ts:44-49`), so leaving `--actor` in
 * argv would break every command it was passed to. Consuming it once is what
 * lets one flag work across all of them without touching a single subcommand.
 *
 * INVARIANT: resolution is READ-ONLY. `od` remembers nothing between
 * invocations -- `OD_ACTOR` in a shell profile is the "set it once" path, and
 * an explicit flag is the per-call override. A stored file would be a second
 * source of truth to keep in step with the browser's own stored name, and
 * writing one would add a daemon-source filesystem write this track is not
 * permitted to inventory (see the PR body's needsOwner note).
 *
 * There is no way to make any of this authoritative and no attempt to: per D-2
 * the name is a label the caller chose, not a credential.
 */
export function resolveCliActor(options: ResolveCliActorOptions = {}): ResolvedCliActor {
  const env = options.env ?? process.env;
  const argv = [...(options.argv ?? process.argv.slice(2))];

  let flagValue: string | null = null;
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === ACTOR_FLAG) {
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        flagValue = next;
        i += 1;
      } else {
        flagValue = '';
      }
      continue;
    }
    if (arg.startsWith(`${ACTOR_FLAG}=`)) {
      flagValue = arg.slice(ACTOR_FLAG.length + 1);
      continue;
    }
    kept.push(arg);
  }

  const fromFlag = normalizeActorName(flagValue);
  if (fromFlag) return { actorName: fromFlag, argv: kept };
  return { actorName: normalizeActorName(env.OD_ACTOR), argv: kept };
}

function originOf(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Decides whether one outgoing request is addressed to this machine's daemon.
 *
 * INVARIANT: the actor header identifies a person to THEIR OWN daemon. It must
 * never reach a third party — `cli.ts` also calls Vimeo and YouTube OAuth
 * endpoints, and leaking a teammate's name into a vendor's request log would be
 * a privacy regression with no upside.
 *
 * The allow-set narrows as the caller gets more specific, mirroring
 * `resolveDaemonUrl` (`daemon-url.ts:71-79`):
 *
 *   - The caller named a daemon (`--daemon-url`, or `OD_DAEMON_URL`): ONLY that
 *     origin. Loopback is not implied — another process listening on another
 *     local port is a different server, and this invocation did not address it.
 *   - The caller named nothing: discovery will land on a loopback port that is
 *     not known yet, so loopback is allowed and nothing else is.
 *
 * Either way a public host is foreign, which is the case that matters.
 */
export function isDaemonRequestUrl(
  rawUrl: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (allowedOrigins.size > 0) return allowedOrigins.has(parsed.origin);
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

export interface InstallCliActorFetchWrapOptions {
  actorName: string | null;
  /** Origin the caller addressed explicitly, e.g. the `--daemon-url` value. */
  daemonBaseUrl?: string | null;
  env?: NodeJS.ProcessEnv;
}

/**
 * Adds `x-od-actor` to the CLI's daemon requests.
 *
 * A single `globalThis.fetch` wrapper instead of threading a header through
 * `cli.ts`'s 241 `fetch(` call sites: one place to read, one place to audit the
 * scoping guard above. Returns an uninstaller.
 *
 * A no-op when no actor resolved — an unattributed CLI must send no header at
 * all, not an empty one.
 */
export function installCliActorFetchWrap(
  options: InstallCliActorFetchWrapOptions,
): () => void {
  const actorName = normalizeActorName(options.actorName);
  if (!actorName) return () => undefined;

  const env = options.env ?? process.env;
  const allowedOrigins = new Set(
    [originOf(options.daemonBaseUrl), originOf(env.OD_DAEMON_URL)].filter(
      (origin): origin is string => typeof origin === 'string',
    ),
  );

  const previous = globalThis.fetch;
  if (typeof previous !== 'function') return () => undefined;
  const original = previous.bind(globalThis);

  type FetchInput = Parameters<typeof globalThis.fetch>[0];
  const wrapped: typeof globalThis.fetch = (input, init) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request | undefined)?.url;
    if (!rawUrl || !isDaemonRequestUrl(rawUrl, allowedOrigins)) {
      return original(input as FetchInput, init);
    }
    const headers = new Headers(
      init?.headers ?? (typeof input === 'object' && input && 'headers' in input
        ? (input as Request).headers
        : undefined),
    );
    headers.set(ACTOR_HEADER_NAME, actorName);
    return original(input as FetchInput, { ...init, headers });
  };

  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = previous;
  };
}

/**
 * Entry-point bootstrap: resolve the actor, strip `--actor` out of the argv the
 * subcommand dispatcher reads, and install the header wrap.
 */
export function bootstrapCliActor(argvFromEntry: string[]): string[] {
  const daemonBaseUrl = daemonUrlFlagValue(argvFromEntry);
  const resolved = resolveCliActor({ argv: argvFromEntry });
  installCliActorFetchWrap({ actorName: resolved.actorName, daemonBaseUrl });
  return resolved.argv;
}

/** Reads `--daemon-url <url>` off the raw argv without consuming it. */
function daemonUrlFlagValue(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--daemon-url') return argv[i + 1] ?? null;
    if (arg.startsWith('--daemon-url=')) return arg.slice('--daemon-url='.length);
  }
  return null;
}
