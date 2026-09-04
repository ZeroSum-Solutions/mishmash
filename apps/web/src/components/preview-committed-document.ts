import { useEffect, useRef } from 'react';

/**
 * Which document a preview frame has actually loaded.
 *
 * `trackPreviewPaint` runs a two-phase navigation epoch: arming tells the frame
 * nothing, and only the incoming `load` discloses the token, so the document
 * being replaced can never answer for its successor. That leaves one case the
 * watchdog cannot see from outside — a WARM transport, whose document loaded
 * long before the watchdog was installed and for which no `load` is coming.
 * `FileViewer` keeps srcDoc frames materialised while hidden and the URL frame
 * alive behind them, so entering Draw or Comment installs a watchdog over a
 * document that is already there.
 *
 * Only the host can answer that, and this is how it answers.
 *
 * The invariant: `committed` is true only for a document the host SAW this
 * frame load and is STILL asking for. Pointing the frame at anything else
 * clears it immediately, before the watchdog effect runs, so a watchdog
 * installed for a new navigation is never told its document has already
 * arrived. Without the clearing half, revisiting a document the frame loaded
 * earlier — A, then B, then A again, with B hanging before it commits — would
 * read as warm while B still occupies the frame, and B's producer would settle
 * the watchdog armed for A. That is the stuck-navigation bug the epoch exists
 * to catch, re-entered through the back door.
 *
 * `target` identifies the document the host wants watched: a preview URL for
 * the URL-load and live-artifact transports, the srcDoc content for the srcDoc
 * transport. Call `noteLoaded` from the frame's own `load` handler, and nowhere
 * else — a value written from anywhere but the frame is a claim the host cannot
 * back.
 */
export function useCommittedDocument(target: string): {
  committed: boolean;
  noteLoaded: () => void;
} {
  const loaded = useRef<string | null>(null);

  // Declared before the watchdog effects that read `committed`, so a changed
  // target has already cleared the latch by the time they run.
  useEffect(() => {
    loaded.current = null;
  }, [target]);

  return {
    committed: loaded.current === target,
    noteLoaded: () => {
      loaded.current = target;
    },
  };
}
