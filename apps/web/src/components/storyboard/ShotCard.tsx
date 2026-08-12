// One storyboard shot's full editor: keyframes, key parameters as chips,
// remaining settings, and a pinned render bar (MM-017 rail-content order).
// Rendered as the body of ShotInspectorRail.tsx (opened per shot from its
// compact ShotRow.tsx summary row) — shot-level actions that don't need the
// full editor (move, duplicate, delete) live on ShotRow instead, not here. Data
// fetching/persistence lives in the parent (StoryboardEditor) — this
// component only renders state and calls back up, which keeps the
// enablement/gating state machine (see shot-editor-state.ts) testable
// without mocking network calls.

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { ReviewStoryboardTakeRequest, StoryboardShot } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { useT } from '../../i18n';
import { findMediaModel, type MediaModel } from '../../media/models';
import {
  STORYBOARD_DURATION_OPTIONS,
  STORYBOARD_UPLOAD_ACCEPT,
  type ConfiguredProviderMap,
  isModelConfigured,
  resolutionForModelId,
} from './model-defaults';
import { Icon } from '../Icon';
import { MediaFallback } from '../MediaFallback';
import { computeRenderButtonMode, computeShotDisplayStatus, computeShotEditorState } from './shot-editor-state';
import styles from './StoryboardSection.module.css';
import { ShotTakeHistory } from './ShotTakeHistory';

export interface ShotCardProps {
  shot: StoryboardShot;
  previousShot: StoryboardShot | null;
  imageModels: MediaModel[];
  i2iImageModels: MediaModel[];
  videoModels: MediaModel[];
  configured: ConfiguredProviderMap;
  frameUrl: (path: string) => string;
  busy: boolean;
  onGenerateStart: (prompt: string, model: string) => void;
  onIterateStart: (prompt: string, model: string) => void;
  onDeriveEnd: (prompt: string, model: string) => void;
  onUsePreviousEndFrame: () => void;
  onUploadFile: (slot: 'start' | 'end', file: File) => void;
  onFieldChange: (patch: Partial<StoryboardShot>) => void;
  onRender: () => void;
  onReviewTake: (takeId: string, review: ReviewStoryboardTakeRequest) => void;
}

function modelLabel(model: MediaModel, configured: ConfiguredProviderMap, t: ReturnType<typeof useT>): string {
  return isModelConfigured(model, configured) ? model.label : `${model.label} ${t('storyboard.needsApiKey')}`;
}

/**
 * A 16:9 "well" for a frame slot (grok design critique G6): the real
 * thumbnail once a frame exists, a dashed empty box otherwise, or a spinner
 * in that same box while a frame is being generated into this specific
 * slot. `busy` here is already slot-scoped by the caller (busy && no frame
 * in THIS slot) — see the two call sites below.
 */
function FrameWell({ url, generating }: { url: string | null; generating: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // A new URL (retry, replace, re-derive) deserves a fresh attempt rather
  // than staying stuck on a previous load's failure or fade-in state.
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [url]);

  if (url && !failed) {
    return (
      <img
        // Hidden until decoded: a failed request never paints a broken-image
        // glyph even for a frame — onLoad reveals it, onError swaps it out
        // for the shared fallback before it ever becomes visible.
        className={`${styles.frameWell}${loaded ? ` ${styles.frameWellLoaded}` : ''}`}
        src={url}
        alt=""
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={styles.frameWellEmpty} aria-hidden>
      {generating ? <Icon name="spinner" size={18} /> : failed ? <MediaFallback size={16} /> : null}
    </div>
  );
}

export function ShotCard(props: ShotCardProps) {
  const {
    shot,
    previousShot,
    imageModels,
    i2iImageModels,
    videoModels,
    configured,
    frameUrl,
    busy,
    onGenerateStart,
    onIterateStart,
    onDeriveEnd,
    onUsePreviousEndFrame,
    onUploadFile,
    onFieldChange,
    onRender,
    onReviewTake,
  } = props;
  const t = useT();
  const state = computeShotEditorState(shot, previousShot);
  // Shared with ShotRow.tsx (react review R5) so the two never disagree on
  // when the primary action reads "Render" vs "Rendering…" vs "Retry".
  const renderMode = computeRenderButtonMode(state, computeShotDisplayStatus(shot, busy));
  const renderLabel =
    renderMode === 'retry' ? t('storyboard.retry') : renderMode === 'rendering' ? t('storyboard.rendering') : t('storyboard.render');
  // Keyframe pairs (start + end frame) only render through the Volcengine /
  // OpenRouter Seedance 2.0 models that declare 'kf' — the daemon 400s an
  // endImage sent against any other model (apps/daemon/src/media/index.ts).
  // Gate the affordance on the CURRENTLY selected video model, not a static
  // list, since a shot's model can change after an end frame was derived.
  const supportsKeyframePairs = Boolean(findMediaModel(shot.model)?.caps?.includes('kf'));

  const [startDialog, setStartDialog] = useState<'generate' | 'replace' | 'iterate' | null>(null);
  const [endDialog, setEndDialog] = useState(false);
  const [startPrompt, setStartPrompt] = useState('');
  const [startModel, setStartModel] = useState(imageModels[0]?.id ?? '');
  const [endPrompt, setEndPrompt] = useState('');
  const [endModel, setEndModel] = useState(i2iImageModels[0]?.id ?? '');

  const [dragOverSlot, setDragOverSlot] = useState<'start' | 'end' | null>(null);
  const startFileInputRef = useRef<HTMLInputElement>(null);
  const endFileInputRef = useRef<HTMLInputElement>(null);

  function handleSlotDragOver(slot: 'start' | 'end', event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!busy) setDragOverSlot(slot);
  }
  function handleSlotDragLeave(slot: 'start' | 'end') {
    setDragOverSlot((current) => (current === slot ? null : current));
  }
  function handleSlotDrop(slot: 'start' | 'end', event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOverSlot(null);
    if (busy) return;
    // Take the first actual image in the drop and defer to onUploadFile's
    // own validation (the exact png/jpeg/webp allowlist + size cap) for the
    // specific error copy — pre-filtering to that strict allowlist here
    // would silently drop e.g. a GIF instead of surfacing "unsupported type".
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) onUploadFile(slot, file);
  }
  function handleFileInputChange(slot: 'start' | 'end', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file next time
    if (file) onUploadFile(slot, file);
  }

  const closeStartDialog = () => setStartDialog(null);
  const submitStartDialog = () => {
    if (!startPrompt.trim() || !startModel) return;
    if (startDialog === 'iterate') onIterateStart(startPrompt.trim(), startModel);
    else onGenerateStart(startPrompt.trim(), startModel);
    setStartPrompt('');
    closeStartDialog();
  };
  const submitEndDialog = () => {
    if (!endPrompt.trim() || !endModel) return;
    onDeriveEnd(endPrompt.trim(), endModel);
    setEndPrompt('');
    setEndDialog(false);
  };

  return (
    <article className={styles.shotCard} data-testid="shot-card" data-shot-status={shot.status}>
      {/* MM-017: Keyframes first (art the shot is built from), then the key
          parameters as side-by-side chips, then the remaining settings, then
          a render bar pinned to the bottom of the rail's own scroll region —
          the Higgsfield mixed-media rail-content pattern applied to this
          shot's fields. The upload constraint is stated once, inline, for
          both slots below rather than repeated per slot. */}
      <div className={styles.sectionHeadRow}>
        <span className={styles.sectionLabel}>{t('storyboard.keyframesHeading')}</span>
        <span className={styles.sectionHint}>{t('storyboard.uploadConstraintHint')}</span>
      </div>
      <div className={styles.shotFrames}>
        <div
          className={`${styles.shotFrameSlot}${dragOverSlot === 'start' ? ` ${styles.shotFrameSlotDragOver}` : ''}`}
          data-testid="start-frame-dropzone"
          onDragOver={(e) => handleSlotDragOver('start', e)}
          onDragLeave={() => handleSlotDragLeave('start')}
          onDrop={(e) => handleSlotDrop('start', e)}
        >
          <span className={styles.shotFrameSlotLabel}>{t('storyboard.startFrame')}</span>
          <FrameWell url={shot.startFrame ? frameUrl(shot.startFrame.path) : null} generating={busy && !shot.startFrame} />
          {shot.startFrame ? (
            <div className={styles.shotFrameActions}>
              <Button
                type="button"
                variant="subtle"
                disabled={busy}
                onClick={() => { setStartDialog('iterate'); setStartModel(i2iImageModels[0]?.id ?? ''); }}
              >
                {t('storyboard.iterate')}
              </Button>
              <Button
                type="button"
                variant="subtle"
                disabled={busy}
                onClick={() => { setStartDialog('replace'); setStartModel(imageModels[0]?.id ?? ''); }}
              >
                {t('storyboard.replace')}
              </Button>
              <Button
                type="button"
                variant="subtle"
                disabled={busy}
                data-testid="start-frame-upload-button"
                onClick={() => startFileInputRef.current?.click()}
              >
                {t('storyboard.uploadImage')}
              </Button>
            </div>
          ) : (
            <div className={styles.shotFrameActions}>
              <Button
                type="button"
                variant="subtle"
                disabled={busy}
                onClick={() => { setStartDialog('generate'); setStartModel(imageModels[0]?.id ?? ''); }}
              >
                {t('storyboard.generate')}
              </Button>
              {state.canUsePreviousEndFrame ? (
                <Button type="button" variant="subtle" disabled={busy} onClick={onUsePreviousEndFrame}>
                  {t('storyboard.usePreviousEndFrame')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="subtle"
                disabled={busy}
                data-testid="start-frame-upload-button"
                onClick={() => startFileInputRef.current?.click()}
              >
                {t('storyboard.uploadImage')}
              </Button>
              <p className={styles.shotDialogHelper}>{t('storyboard.dropImageHint')}</p>
            </div>
          )}
          <input
            ref={startFileInputRef}
            type="file"
            tabIndex={-1}
            accept={STORYBOARD_UPLOAD_ACCEPT}
            className={styles.hiddenFileInput}
            data-testid="start-frame-file-input"
            onChange={(e) => handleFileInputChange('start', e)}
          />
          {startDialog ? (
            <div className={styles.shotDialog} data-testid="start-frame-dialog">
              <textarea
                className={styles.shotDialogTextarea}
                placeholder={t('storyboard.startPromptPlaceholder')}
                value={startPrompt}
                onChange={(e) => setStartPrompt(e.target.value)}
              />
              <select value={startModel} onChange={(e) => setStartModel(e.target.value)}>
                {(startDialog === 'iterate' ? i2iImageModels : imageModels).map((m) => (
                  <option key={m.id} value={m.id}>{modelLabel(m, configured, t)}</option>
                ))}
              </select>
              <div className={styles.shotDialogActions}>
                <Button type="button" variant="primary" disabled={!startPrompt.trim() || busy} onClick={submitStartDialog}>
                  {t('storyboard.generate')}
                </Button>
                <Button type="button" variant="ghost" onClick={closeStartDialog}>{t('storyboard.cancel')}</Button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={`${styles.shotFrameSlot}${dragOverSlot === 'end' ? ` ${styles.shotFrameSlotDragOver}` : ''}`}
          data-testid="end-frame-dropzone"
          onDragOver={(e) => handleSlotDragOver('end', e)}
          onDragLeave={() => handleSlotDragLeave('end')}
          onDrop={(e) => handleSlotDrop('end', e)}
        >
          <span className={styles.shotFrameSlotLabel}>{t('storyboard.endFrame')}</span>
          <FrameWell url={shot.endFrame ? frameUrl(shot.endFrame.path) : null} generating={busy && !shot.endFrame} />
          {shot.endFrame ? (
            <Button
              type="button"
              variant="subtle"
              disabled={busy}
              data-testid="end-frame-upload-button"
              onClick={() => endFileInputRef.current?.click()}
            >
              {t('storyboard.uploadImage')}
            </Button>
          ) : (
            <div className={styles.shotFrameActions}>
              {supportsKeyframePairs ? (
                <Button
                  type="button"
                  variant="subtle"
                  disabled={!state.canDeriveEndFrame || busy}
                  onClick={() => { setEndDialog(true); setEndModel(i2iImageModels[0]?.id ?? ''); }}
                >
                  {t('storyboard.deriveEndFrame')}
                </Button>
              ) : (
                <p className={styles.shotDialogHelper} data-testid="derive-end-frame-unsupported-hint">
                  {t('storyboard.deriveEndFrameNeedsKeyframeModel')}
                </p>
              )}
              <Button
                type="button"
                variant="subtle"
                disabled={busy}
                data-testid="end-frame-upload-button"
                onClick={() => endFileInputRef.current?.click()}
              >
                {t('storyboard.uploadImage')}
              </Button>
              <p className={styles.shotDialogHelper}>{t('storyboard.dropImageHint')}</p>
            </div>
          )}
          <input
            ref={endFileInputRef}
            type="file"
            tabIndex={-1}
            accept={STORYBOARD_UPLOAD_ACCEPT}
            className={styles.hiddenFileInput}
            data-testid="end-frame-file-input"
            onChange={(e) => handleFileInputChange('end', e)}
          />
          {endDialog ? (
            <div className={styles.shotDialog} data-testid="end-frame-dialog">
              <p className={styles.shotDialogHelper}>{t('storyboard.deriveEndFrameHelper')}</p>
              <textarea
                className={styles.shotDialogTextarea}
                placeholder={t('storyboard.endPromptPlaceholder')}
                value={endPrompt}
                onChange={(e) => setEndPrompt(e.target.value)}
              />
              <select value={endModel} onChange={(e) => setEndModel(e.target.value)}>
                {i2iImageModels.map((m) => (
                  <option key={m.id} value={m.id}>{modelLabel(m, configured, t)}</option>
                ))}
              </select>
              <div className={styles.shotDialogActions}>
                <Button type="button" variant="primary" disabled={!endPrompt.trim() || busy} onClick={submitEndDialog}>
                  {t('storyboard.deriveEndFrame')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEndDialog(false)}>{t('storyboard.cancel')}</Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Key parameters as side-by-side chips (Higgsfield rail-content
          pattern) — model and duration together, ahead of the free-text
          settings below; resolution is implied by the model (see
          resolutionForModelId) so it isn't a separate control. */}
      <span className={styles.sectionLabel}>{t('storyboard.parametersHeading')}</span>
      <div className={styles.paramsChipsRow}>
        <select
          className={styles.modelSelect}
          value={shot.model}
          onChange={(e) => {
            const model = e.target.value;
            // The video model catalog IS the resolution picker (see
            // resolutionForModelId's doc comment in model-defaults.ts) —
            // recompute it alongside the model, or a model swap leaves the
            // previous model's resolution persisted as stale metadata.
            // Also drop a previously-derived end frame when the newly
            // selected model doesn't support keyframe pairs — otherwise a
            // stale endFrame would still get sent as endImage at render time
            // and the daemon would 400 (see supportsKeyframePairs above).
            const nextSupportsKf = Boolean(findMediaModel(model)?.caps?.includes('kf'));
            onFieldChange({
              model,
              resolution: resolutionForModelId(model),
              ...(!nextSupportsKf && shot.endFrame ? { endFrame: undefined } : {}),
            });
          }}
          aria-label={t('storyboard.videoModel')}
        >
          {videoModels.map((m) => (
            <option key={m.id} value={m.id}>{modelLabel(m, configured, t)}</option>
          ))}
        </select>
        <select
          className={styles.durationSelect}
          value={shot.durationSec}
          onChange={(e) => onFieldChange({ durationSec: Number(e.target.value) })}
          aria-label={t('storyboard.duration')}
        >
          {STORYBOARD_DURATION_OPTIONS.map((sec) => (
            <option key={sec} value={sec}>{sec}s</option>
          ))}
        </select>
      </div>

      {/* Settings: the remaining field(s) — just the motion prompt today. */}
      <span className={styles.sectionLabel}>{t('storyboard.settingsHeading')}</span>
      <textarea
        className={styles.motionPromptInput}
        placeholder={t('storyboard.motionPromptPlaceholder')}
        value={shot.motionPrompt}
        onChange={(e) => onFieldChange({ motionPrompt: e.target.value })}
        data-testid="motion-prompt-input"
      />

      {shot.status === 'rendering' ? (
        <p className={styles.shotStatusLine}>{t('storyboard.rendering')}</p>
      ) : shot.status === 'failed' ? (
        <p className={`${styles.shotStatusLine} ${styles.shotStatusError}`}>{shot.error || t('storyboard.renderFailed')}</p>
      ) : shot.status === 'done' && shot.output && !shot.takes?.length ? (
        <video className={styles.shotVideoPreview} src={frameUrl(shot.output)} controls muted loop />
      ) : null}

      {shot.takes?.length ? (
        <ShotTakeHistory
          takes={shot.takes}
          reviews={shot.takeReviews ?? {}}
          selectedTakeId={shot.selectedTakeId}
          frameUrl={frameUrl}
          onReview={onReviewTake}
        />
      ) : null}

      {/* Pinned commit action (Higgsfield rail-content pattern): sticky to
          the bottom of whichever ancestor actually scrolls (the inspector
          rail's body when rendered there), full-width, high-contrast. */}
      <div className={styles.renderFooter}>
        <Button
          type="button"
          variant="primary"
          disabled={!state.canRender || busy}
          onClick={onRender}
          data-testid="render-shot-button"
          title={state.renderDisabledReason ?? undefined}
        >
          {renderLabel}
        </Button>
      </div>
    </article>
  );
}
