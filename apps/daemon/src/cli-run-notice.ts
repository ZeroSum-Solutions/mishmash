/**
 * INV-7.15 (wave 7, spec-audit-r2, W7-R2-16 — binding, Sol's exact wording):
 *
 * "A following `od run` command writes every SSE frame, including terminal
 * status, as unchanged ND-JSON on stdout; on `end`, stderr receives exactly
 * one `Run finished: <status>` line, prefixed with BEL only when stderr is
 * a TTY and `--json` is false."
 *
 * `completionNotice` is the pure decision this invariant describes: it
 * reads no process state itself. The caller (`streamRunEvents`,
 * `cli.ts:8223-8264`) resolves `process.stderr.isTTY` and the `--json` flag
 * and writes the returned line to stderr on the terminal `end` frame —
 * stdout's ND-JSON stream is untouched in every case. There is no
 * `--verbose` flag and no CLI mute: the non-TTY and `--json` cases get the
 * identical line, only without the BEL prefix, never a different message.
 */

export interface CompletionNoticeInput {
  /** `process.stderr.isTTY` — never `process.stdout.isTTY`; the notice is
   * written to stderr, so it is stderr's TTY-ness that decides the BEL. */
  isTTY: boolean;
  /** The `--json` CLI flag for this invocation. */
  json: boolean;
  /** The terminal run status carried on the SSE `end` frame's `status`
   * field (`ChatSseEndPayload.status`, `packages/contracts/src/sse/chat.ts`). */
  status: string;
}

/** Returns the exact line to write to stderr, newline included. */
export function completionNotice(input: CompletionNoticeInput): string {
  const bel = input.isTTY && !input.json ? '' : '';
  return `${bel}Run finished: ${input.status}\n`;
}
