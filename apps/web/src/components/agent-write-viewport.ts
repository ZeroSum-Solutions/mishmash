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
 * A rewrite reaches the watcher as `unlink` + `add` and then a run of
 * `change` events that lasts as long as the write does. Each refresh
 * re-fetches the file list and cache-busts the viewer iframe, so refreshing
 * mid-write reloads the document under the user — losing scroll position and
 * showing half-written source.
 *
 * `wait` is therefore the quiet window that defines "settled": longer than
 * any single rename burst, short enough that a finished write still appears
 * promptly. `maxWait` is the starvation bound for a write that never goes
 * quiet; it matches chokidar's own `awaitWriteFinish.stabilityThreshold`
 * default, so a pathological stream of events costs one refresh every two
 * seconds instead of four per second.
 */
export const SETTLED_WRITE_REFRESH = { wait: 250, maxWait: 2_000 } as const;
