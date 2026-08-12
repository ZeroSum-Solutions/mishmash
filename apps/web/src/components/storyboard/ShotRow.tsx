// Compact one-line summary of a storyboard shot (PRD C4 outcome 1: "compact
// shot rows"): frame thumbnails, a prompt snippet, the current model, an
// at-a-glance generation-status badge (outcome 3: queued/generating/failed
// with a retry affordance/done), a Render/Retry/Fix-in-details action, and
// an Edit button that selects this shot in the persistent inspector rail
// (ShotInspectorRail.tsx). Shot editing itself (frame generation/upload/
// derive, motion prompt, model+duration) lives in ShotCard.tsx, rendered
// inside that rail — this component never edits shot state directly, it
// only surfaces it and calls back up.
//
// Memoized (react review R3): a status flip on one shot during a 15-25 min
// render poll must not re-render every OTHER row. That only holds if every
// prop stays referentially stable for the rows that didn't change — see
// StoryboardEditor.tsx's stable, shotId-keyed dispatcher callbacks
// (`handleRenderShot`, `duplicateShot`, `deleteShot`, `moveShotUp`,
// `moveShotDown`, `toggleShotDetails`), which is why every callback prop
// here takes a shotId instead of being a fresh closure built per row.

import { memo, useEffect, useRef, useState } from 'react';
import type { StoryboardShot } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { findMediaModel, type MediaModel } from '../../media/models';
import { type ConfiguredProviderMap, isModelConfigured } from './model-defaults';
import { computeRenderButtonMode, computeShotDisplayStatus, computeShotEditorState } from './shot-editor-state';
import styles from './ShotRow.module.css';

export interface ShotRowProps {
  shot: StoryboardShot;
  index: number;
  previousShot: StoryboardShot | null;
  videoModels: MediaModel[];
  configured: ConfiguredProviderMap;
  frameUrl: (path: string) => string;
  busy: boolean;
  detailsOpen: boolean;
  onToggleDetails: (shotId: string) => void;
  onRender: (shotId: string) => void;
  onDuplicate: (shotId: string) => void;
  onDelete: (shotId: string) => void;
  onMoveUp: (shotId: string) => void;
  onMoveDown: (shotId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * A frame-slot thumbnail (grok design critique G2): a real image when set,
 * otherwise a clickable "+ Start"/"+ End" affordance that opens the drawer
 * — replacing the old inert, unlabeled placeholder icon (nothing on the row
 * previously said what an empty slot even was, let alone that clicking it
 * would do anything).
 */
function FrameSlotThumb({
  path,
  frameUrl,
  emptyLabel,
  onOpenDetails,
}: {
  path: string | undefined;
  frameUrl: (path: string) => string;
  emptyLabel: string;
  onOpenDetails: () => void;
}) {
  if (!path) {
    return (
      <button type="button" className={styles.thumbPlaceholder} onClick={onOpenDetails}>
        {emptyLabel}
      </button>
    );
  }
  return <img className={styles.thumb} src={frameUrl(path)} alt="" />;
}

/** Indeterminate progress pattern (grok design critique G7, partial) shown
 * in the action slot instead of a button while a shot is actively rendering
 * — there's no real percent to report, so this is a moving-stripe
 * indicator, not a disabled "Rendering…" button. */
function RenderProgress({ label }: { label: string }) {
  return (
    <div className={styles.renderProgress} role="status" aria-label={label}>
      <div className={styles.renderProgressTrack}>
        <div className={styles.renderProgressBar} />
      </div>
    </div>
  );
}

function ShotRowImpl(props: ShotRowProps) {
  const {
    shot,
    index,
    previousShot,
    videoModels,
    configured,
    frameUrl,
    busy,
    detailsOpen,
    onToggleDetails,
    onRender,
    onDuplicate,
    onDelete,
    onMoveUp,
    onMoveDown,
    canMoveUp,
    canMoveDown,
  } = props;
  const t = useT();
  const state = computeShotEditorState(shot, previousShot);
  const displayStatus = computeShotDisplayStatus(shot, busy);
  const renderMode = computeRenderButtonMode(state, displayStatus);
  const model = videoModels.find((m) => m.id === shot.model) ?? findMediaModel(shot.model);
  const modelLabel = model
    ? isModelConfigured(model, configured)
      ? model.label
      : `${model.label} ${t('storyboard.needsApiKey')}`
    : shot.model;
  const promptSnippet = shot.motionPrompt.trim();
  const shotTitle = shot.title?.trim() ?? '';
  const summaryTitle = [shotTitle, promptSnippet].filter(Boolean).join(' · ');

  // Steady kebab menu (grok design critique G4) for move/duplicate/delete —
  // replaces four always-on faint icon buttons that "failed the what's
  // clickable test". Closes on outside click, matching the local menu
  // pattern already used elsewhere in this app (PluginScenarioDetail's
  // useMenuOpen + document mousedown listener).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menuOpen]);

  function runMenuAction(action: (shotId: string) => void) {
    setMenuOpen(false);
    action(shot.id);
  }

  const openDetails = () => onToggleDetails(shot.id);

  // React review R4: never show a disabled Retry — a failed shot missing a
  // prerequisite (no start frame, no motion prompt) gets an ENABLED "Fix in
  // details" CTA that opens the drawer instead of a dead-end button.
  const showFixInDetails = displayStatus === 'failed' && !state.canRender;

  const renderButtonLabel =
    renderMode === 'retry' ? t('storyboard.retry') : renderMode === 'rendering' ? t('storyboard.rendering') : t('storyboard.render');

  return (
    <article
      className={`${styles.row}${detailsOpen ? ` ${styles.rowOpen}` : ''}`}
      data-testid="shot-row"
      data-shot-status={shot.status}
      data-display-status={displayStatus}
    >
      <span className={styles.index}>{t('storyboard.shotLabel', { number: index + 1 })}</span>

      <div className={styles.frames}>
        <FrameSlotThumb
          path={shot.startFrame?.path}
          frameUrl={frameUrl}
          emptyLabel={t('storyboard.addStartFrame')}
          onOpenDetails={openDetails}
        />
        <Icon name="chevron-right" size={12} className={styles.framesArrow} />
        <FrameSlotThumb
          path={shot.endFrame?.path}
          frameUrl={frameUrl}
          emptyLabel={t('storyboard.addEndFrame')}
          onOpenDetails={openDetails}
        />
      </div>

      <div className={styles.main}>
        <p className={styles.prompt} title={summaryTitle || undefined}>
          {shotTitle ? <strong className={styles.shotTitle}>{shotTitle}</strong> : null}
          {shotTitle && promptSnippet ? <span aria-hidden> · </span> : null}
          <span className={promptSnippet ? undefined : styles.promptPlaceholder}>
            {promptSnippet || t('storyboard.noMotionPromptYet')}
          </span>
        </p>
        <span className={styles.modelChip}>{modelLabel}</span>
      </div>

      <div className={styles.status}>
        {displayStatus === 'done' ? (
          <span className={`${styles.badge} ${styles.badgeDone}`} data-testid="shot-status-badge" data-status="done">
            <Icon name="check" size={12} />
            {t('storyboard.statusDone')}
          </span>
        ) : displayStatus === 'failed' ? (
          <span className={`${styles.badge} ${styles.badgeFailed}`} data-testid="shot-status-badge" data-status="failed">
            <Icon name="alert-triangle" size={12} />
            {shot.error || t('storyboard.statusFailed')}
          </span>
        ) : displayStatus === 'generating' ? (
          <span className={`${styles.badge} ${styles.badgeGenerating}`} data-testid="shot-status-badge" data-status="generating">
            <Icon name="spinner" size={12} />
            {t('storyboard.rendering')}
          </span>
        ) : displayStatus === 'queued' ? (
          <span className={`${styles.badge} ${styles.badgeQueued}`} data-testid="shot-status-badge" data-status="queued">
            <Icon name="spinner" size={12} />
            {t('storyboard.statusQueued')}
          </span>
        ) : null}
      </div>

      <div className={styles.actions}>
        {displayStatus === 'generating' ? (
          <RenderProgress label={t('storyboard.rendering')} />
        ) : showFixInDetails ? (
          <Button type="button" variant="subtle" onClick={openDetails} data-testid="row-fix-in-details-button">
            {t('storyboard.fixInDetails')}
          </Button>
        ) : (
          // Grok design critique G7 (partial): the row's Render/Retry
          // stays, but quiet/secondary now — the drawer's own Render is the
          // one primary action for a shot.
          <Button
            type="button"
            variant="subtle"
            disabled={!state.canRender || busy}
            onClick={() => onRender(shot.id)}
            data-testid="row-render-button"
            title={state.renderDisabledReason ?? undefined}
          >
            {renderButtonLabel}
          </Button>
        )}
        <button
          type="button"
          className={styles.detailsToggle}
          aria-expanded={detailsOpen}
          aria-controls={`shot-details-drawer-${shot.id}`}
          onClick={openDetails}
          data-testid="shot-details-toggle"
        >
          {t('storyboard.detailsToggle')}
        </button>
      </div>

      <div className={styles.rowMenu} ref={menuRef}>
        <button
          type="button"
          className={styles.rowMenuTrigger}
          aria-label={t('storyboard.rowActionsMenu')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          data-testid="row-actions-trigger"
        >
          <Icon name="more-horizontal" size={16} />
        </button>
        {menuOpen ? (
          <div className={styles.rowMenuPanel} role="menu" data-testid="row-actions-menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => runMenuAction(onMoveUp)}
              disabled={!canMoveUp}
            >
              <Icon name="chevron-left" size={14} />
              {t('storyboard.moveShotUp')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runMenuAction(onMoveDown)}
              disabled={!canMoveDown}
            >
              <Icon name="chevron-right" size={14} />
              {t('storyboard.moveShotDown')}
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(onDuplicate)}>
              <Icon name="copy" size={14} />
              {t('storyboard.duplicateShot')}
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(onDelete)}>
              <Icon name="trash" size={14} />
              {t('storyboard.deleteShot')}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export const ShotRow = memo(ShotRowImpl);
