import { useRef } from 'react';

/**
 * Which document a preview frame has actually loaded.
 *
 * `trackPreviewPaint` runs a two-phase navigation epoch: arming tells the frame
 * nothing, and only the incoming `load` discloses the token, so the document
 * being replaced can never answer for its successor. That leaves two cases the
 * watchdog cannot see from outside, and the host is the only one who can answer
 * either.
 *
 * A WARM transport, whose document loaded long before the watchdog was
 * installed and for which no `load` is coming. `FileViewer` keeps srcDoc frames
 * materialised while hidden and the URL frame alive behind them, so entering
 * Draw or Comment installs a watchdog over a document that is already there.
 *
 * A FAST transport, whose document loaded between the render that pointed the
 * frame at it and the passive effect that installs the watchdog — a cached
 * srcDoc, a tiny HTML file. React attaches the frame's `onLoad` during the
 * commit and runs passive effects afterwards, so `noteLoaded` has already run
 * while `trackPreviewPaint` does not yet exist: its own `load` listener will
 * never fire, and no second `load` is coming either.
 *
 * The invariant: `committed` answers for the moment it is READ, not for the
 * render that produced this object. It is a getter over a ref, so the watchdog
 * effect — which reads it inside the effect body, at installation — sees a
 * `load` that landed after its render. That closes the fast case without the
 * effect having to re-run, which matters: a re-run would build a second
 * watchdog, arm a second epoch and start a second deadline over a document that
 * had already answered the first.
 *
 * The other half of the invariant: `committed` is true only for a document the
 * host SAW this frame load and is STILL asking for. Pointing the frame at
 * anything else clears the latch DURING RENDER, so a watchdog installed for a
 * new navigation is never told its document has already arrived. Clearing in an
 * effect would be too late for the fast case — that effect runs after the
 * `load` it would be wiping. Without the clearing half, revisiting a document
 * the frame loaded earlier — A, then B, then A again, with B hanging before it
 * commits — would read as warm while B still occupies the frame, and B's
 * producer would settle the watchdog armed for A. That is the stuck-navigation
 * bug the epoch exists to catch, re-entered through the back door.
 *
 * Both render-phase writes are idempotent, so a render React runs twice (Strict
 * Mode) or discards costs at worst a cleared latch — a missed disclosure, never
 * a false one.
 *
 * `target` identifies the document the host wants watched: a preview URL for
 * the URL-load and live-artifact transports, the srcDoc content for the srcDoc
 * transport. Call `noteLoaded` from the frame's own `load` handler, and nowhere
 * else — a value written from anywhere but the frame is a claim the host cannot
 * back.
 */
export function useCommittedDocument(target: string): {
  readonly committed: boolean;
  noteLoaded: () => void;
} {
  const watched = useRef(target);
  const loaded = useRef(false);

  if (watched.current !== target) {
    watched.current = target;
    loaded.current = false;
  }

  return {
    get committed() {
      return loaded.current;
    },
    noteLoaded: () => {
      loaded.current = true;
    },
  };
}
