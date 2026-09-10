// W8C item 1: every line the running daemon PROCESS writes to its log must
// carry an ISO-8601 UTC timestamp, so an error in
// `~/Library/Logs/zs-ai-os/mishmash-team.{out,err}.log` can be dated. The
// daemon's existing logger is `console` itself -- there is no dedicated
// logger module and ~1000 call sites across `server.ts`, `library-sync.ts`,
// etc. call `console.log`/`warn`/`error` directly. Rather than introduce a
// second logger those call sites would have to migrate to, this wraps the
// SAME `console` once, at daemon-process start (`startDaemonRuntime`).

let installed = false;

/**
 * Must hold: after calling this once, every `log`/`info`/`warn`/`error`/
 * `debug` call on `target` prepends a bracketed `new Date().toISOString()`
 * (already UTC) as a new leading argument, then delegates to the original
 * method with the rest of the arguments untouched -- an object argument
 * still prints structured, not stringified into the message. A second call
 * (e.g. a test that starts the runtime twice in one process) is a silent
 * no-op: it must never double-prefix a line.
 */
export function installUtcLogTimestamps(target: Console = console): void {
  if (installed) return;
  installed = true;

  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  for (const method of methods) {
    const original = target[method].bind(target);
    target[method] = ((...args: unknown[]) => {
      original(`[${new Date().toISOString()}]`, ...args);
    }) as Console[typeof method];
  }
}
