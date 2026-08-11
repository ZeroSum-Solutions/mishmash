// MM-017: persistent right-docked inspector rail for the selected shot —
// replaces the modal ShotDetailsDrawer. Rail-side decision (Devin, over
// Higgsfield's left rail) + rail-content pattern (selected-item summary up
// top with a "Change" affordance, then keyframes/upload, then key
// parameters as chips, then remaining settings, then a pinned commit
// action) both come from Devin's own MishMash Storyboard mockup
// (`data-mm-inspector`, `border-left`) and the Higgsfield mixed-media rail
// it was modeled on. See ShotCard.tsx for the keyframes/parameters/settings
// body content and its own pinned Render button; this component owns only
// the rail chrome around it: the idle (nothing selected) state, and the
// header's selected-shot summary + prev/next "Change" navigation + close.
//
// Unlike the drawer it replaces, this is normal document flow (no backdrop,
// no fixed positioning, no focus trap) — it never covers or dims the
// canvas beside it, and stays visually pinned to the viewport via
// position: sticky as the canvas scrolls, not a portal/overlay.

import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { computeShotDisplayStatus } from './shot-editor-state';
import { ShotCard, type ShotCardProps } from './ShotCard';
import styles from './ShotInspectorRail.module.css';

export interface ShotInspectorRailProps extends Omit<ShotCardProps, 'shot'> {
  /** The shot currently selected for editing, or null when none is (the
   * rail still renders — docked, taking up its column — with an idle hint
   * instead of collapsing away and letting the canvas width jump around). */
  shot: StoryboardShotOrNull;
  /** 0-based position of `shot` within the ordered shot list; only
   * meaningful when `shot` is non-null. */
  index: number;
  onSelectPrevious: () => void;
  onSelectNext: () => void;
  canSelectPrevious: boolean;
  canSelectNext: boolean;
  onClose: () => void;
}

// Local alias only so the prop doc comment above reads cleanly; avoids a
// second import line for a type already re-exported through ShotCardProps.
type StoryboardShotOrNull = ShotCardProps['shot'] | null;

export function ShotInspectorRail({
  shot,
  index,
  onSelectPrevious,
  onSelectNext,
  canSelectPrevious,
  canSelectNext,
  onClose,
  ...shotCardProps
}: ShotInspectorRailProps) {
  const t = useT();

  if (!shot) {
    return (
      <aside className={styles.rail} data-testid="shot-details-drawer" aria-label={t('storyboard.selectShotHint')}>
        <p className={styles.idle}>{t('storyboard.selectShotHint')}</p>
      </aside>
    );
  }

  const displayStatus = computeShotDisplayStatus(shot, shotCardProps.busy);
  const promptSnippet = shot.motionPrompt.trim();
  const thumbPath = shot.startFrame?.path;

  return (
    <aside className={styles.rail} data-testid="shot-details-drawer">
      <header className={styles.head}>
        <button
          type="button"
          className={styles.navButton}
          aria-label={t('storyboard.previousShot')}
          disabled={!canSelectPrevious}
          onClick={onSelectPrevious}
          data-testid="shot-inspector-prev"
        >
          <Icon name="chevron-left" size={14} />
        </button>

        <div className={styles.summary}>
          {thumbPath ? (
            <img className={styles.summaryThumb} src={shotCardProps.frameUrl(thumbPath)} alt="" />
          ) : (
            <span className={styles.summaryThumbEmpty} aria-hidden />
          )}
          <div className={styles.summaryText}>
            <span className={styles.summaryTitleRow}>
              <span className={styles.summaryTitle}>{t('storyboard.shotLabel', { number: index + 1 })}</span>
              {displayStatus !== 'idle' ? (
                <span className={styles.summaryStatus} data-status={displayStatus}>
                  {displayStatus === 'done'
                    ? t('storyboard.statusDone')
                    : displayStatus === 'failed'
                      ? t('storyboard.statusFailed')
                      : displayStatus === 'queued'
                        ? t('storyboard.statusQueued')
                        : t('storyboard.rendering')}
                </span>
              ) : null}
            </span>
            <p
              className={`${styles.summaryPrompt}${promptSnippet ? '' : ` ${styles.summaryPromptPlaceholder}`}`}
              data-testid="shot-inspector-summary-prompt"
            >
              {promptSnippet || t('storyboard.noMotionPromptYet')}
            </p>
          </div>
        </div>

        <button
          type="button"
          className={styles.navButton}
          aria-label={t('storyboard.nextShot')}
          disabled={!canSelectNext}
          onClick={onSelectNext}
          data-testid="shot-inspector-next"
        >
          <Icon name="chevron-right" size={14} />
        </button>

        <button
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
        <ShotCard shot={shot} {...shotCardProps} />
      </div>
    </aside>
  );
}
