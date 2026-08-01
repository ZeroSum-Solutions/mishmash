// Right-side drawer that hosts a shot's full editor (ShotCard.tsx) — PRD C4
// outcome 1: "shot editing moves out of giant inline cards into a drawer
// opened per shot." Opened from ShotRow.tsx's "Edit" button. Built on the
// shared Dialog primitive with includeChromeClassName={false} (same pattern
// as PluginScenarioDetail.tsx's custom-shaped modal) so it can be styled as
// a slide-in side panel instead of a centered modal, while keeping Dialog's
// escape-to-close and click-outside-to-close behavior. The shared Dialog
// primitive itself is never modified — react review R2/R8/R9 are both
// implemented locally, inside this file.
//
// `open` vs. mounted: StoryboardEditor keeps rendering this component for a
// short grace period AFTER `open` flips false so the exit animation (react
// review R8/R9) actually gets to play — React would otherwise unmount the
// DOM node synchronously and skip it entirely (AGENTS.md "UI animation
// philosophy": keep mounted, toggle a class). `onExited` tells the parent
// once that grace period has elapsed and it's safe to stop rendering this
// component altogether.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '@open-design/components';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { ShotCard, type ShotCardProps } from './ShotCard';
import styles from './ShotDetailsDrawer.module.css';

/** Matches --dur-exit (AGENTS.md UI animation philosophy: exit ~140ms). */
const DRAWER_EXIT_MS = 140;

const FOCUSABLE_SELECTOR = 'a[href], button, textarea, input, select, [tabindex]';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export interface ShotDetailsDrawerProps extends ShotCardProps {
  index: number;
  /** Whether the drawer should be visually open. Flipping this to false
   * starts the exit animation rather than unmounting immediately — see the
   * module doc comment. */
  open: boolean;
  onClose: () => void;
  /** Called once the exit animation has finished — the parent stops
   * rendering this component in response (react review R8/R9). Must stay
   * referentially stable (e.g. via useCallback with no deps): this effect
   * depends on it, and an identity change would restart the exit timer. */
  onExited?: () => void;
}

export function ShotDetailsDrawer({ index, open, onClose, onExited, ...shotCardProps }: ShotDetailsDrawerProps) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const title = t('storyboard.shotLabel', { number: index + 1 });
  const drawerId = `shot-details-drawer-${shotCardProps.shot.id}`;

  // Keep the DOM node mounted through the exit animation, then let the
  // parent know it can stop rendering us (react review R8/R9).
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => {
      setMounted(false);
      onExited?.();
    }, DRAWER_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, onExited]);

  // Body scroll-lock tracks `open` directly (not the animated `mounted`
  // grace period) — release it the moment closing is triggered rather than
  // waiting out the exit animation (react review R6).
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Focus management (react review R6): move focus to the close button the
  // moment the drawer opens, and restore it to whatever had focus before
  // (the row's own Edit button) the moment it closes — also not waiting for
  // the exit animation, so keyboard users aren't left focus-stranded on a
  // fading-out panel.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeRef.current?.focus();
    } else {
      previouslyFocusedRef.current?.focus();
    }
  }, [open]);

  // Minimal Tab focus trap (react review R2), implemented locally — the
  // shared Dialog primitive is not touched. Wraps Tab/Shift+Tab between the
  // first and last focusable elements inside the drawer's own content.
  function handleContainerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const container = containerRef.current;
    if (!container) return;
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!mounted) return null;

  const stateClass = open ? '' : ` ${styles.closing}`;

  return (
    <Dialog
      includeChromeClassName={false}
      backdropClassName={`${styles.backdrop}${stateClass}`}
      className={`${styles.drawer}${stateClass}`}
      ariaLabel={title}
      onClose={onClose}
      closeOnEscape
      data-testid="shot-details-drawer"
      id={drawerId}
    >
      <div ref={containerRef} className={styles.container} onKeyDown={handleContainerKeyDown}>
        {/* Grok design critique G5/e1: a pinned header (title + close) with
            content scrolling under it fixes "SHOT 1" clipping under the top
            edge. Deviation: G5 also asked for Render in this header, but
            Render already lives in ShotCard's own render-controls block —
            the state machine backing it is extensively covered by
            ShotCard.test.tsx, so it stays there rather than being
            duplicated/relocated; the panel is short enough that it's
            reachable without scrolling in the normal case. */}
        <header className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={t('storyboard.closeDetails')}
            data-testid="shot-details-close"
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className={styles.body}>
          <ShotCard {...shotCardProps} />
        </div>
      </div>
    </Dialog>
  );
}
