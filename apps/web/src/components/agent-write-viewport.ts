// Agent file activity happens in the background. This module holds the two
// rules that keep it there, so both read as invariants at their call sites
// rather than as guards bolted onto the streaming handler.
//
// Root cause they answer (B-09, ux-error-log 2026-08-27): every successful
// agent file-write `tool_result` asked the workspace to open the file that was
// just written, and every intermediate chokidar event refreshed the preview.
// Together they moved the user's viewport to the agent's file, over and over,
// mid-write — "it keeps landing on the brand spec page".

/**
 * Invariant: an agent file write never changes which file the user is
 * looking at.
 *
 * An agent-produced file may take focus only when the user has no view of
 * their own to lose — no active workspace tab at all, which is the state a
 * brand-new project sits in before its first generation. Once any tab is
 * active, the write is background work: the file still reaches the user
 * through the produced-file chips and the Design Files list, but it never
 * takes the viewport.
 *
 * Re-focusing the file the user is *already* on is not a move, so it stays
 * allowed; the workspace treats it as a no-op.
 *
 * @param activeTabId The workspace tab the user currently has active, or
 *   `null` when nothing is open.
 * @param fileName The file the agent wrote.
 */
export function agentWriteMayFocusFile(
  activeTabId: string | null | undefined,
  fileName: string,
): boolean {
  if (!activeTabId) return true;
  return activeTabId === fileName;
}

/**
 * Invariant: the preview refreshes once per settled write, not once per
 * intermediate filesystem event.
 *
 * A rewrite reaches the client as a burst — `unlink` + `add` for a
 * temp-file-and-move, `change` for an in-place edit, plus one burst per file
 * when a turn writes several. Refreshing on an intermediate event of a burst
 * makes the open tab's file vanish for a frame and re-fetches the list before
 * the write is whole.
 *
 * `wait` is the quiet window that defines "settled": longer than one burst,
 * short enough that a finished write still appears promptly. The producer
 * already de-bounces per file — the daemon's project watcher runs chokidar
 * with `awaitWriteFinish` (`apps/daemon/src/project-watchers.ts`,
 * `DEFAULT_AWAIT_WRITE_FINISH`), so an event means that file has stopped
 * changing, and the client never has to guess at a half-written file. If that
 * threshold is ever retuned, retune this window with it.
 *
 * `maxWait` bounds how long a continuing stream of settled writes may defer
 * the refresh. It is not a compromise on the invariant: past the cap the
 * events being coalesced are many completed writes, not one unfinished one,
 * and holding the preview back further would leave the canvas stale while the
 * agent keeps working.
 */
export const SETTLED_WRITE_REFRESH = { wait: 250, maxWait: 2_000 } as const;
