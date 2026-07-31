// One storyboard shot: start/end keyframe slots, a motion-only prompt, and
// render controls. Data fetching/persistence lives in the parent
// (StoryboardEditor) — this component only renders state and calls back up,
// which keeps the enablement/gating state machine (see shot-editor-state.ts)
// testable without mocking network calls.

import { useState } from 'react';
import type { StoryboardFrameRef, StoryboardShot } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { findMediaModel, type MediaModel } from '../../media/models';
import {
  STORYBOARD_DURATION_OPTIONS,
  type ConfiguredProviderMap,
  isModelConfigured,
  resolutionForModelId,
} from './model-defaults';
import { computeShotEditorState } from './shot-editor-state';
import styles from './StoryboardSection.module.css';

export interface ShotCardProps {
  shot: StoryboardShot;
  index: number;
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
  onFieldChange: (patch: Partial<StoryboardShot>) => void;
  onRender: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function modelLabel(model: MediaModel, configured: ConfiguredProviderMap, t: ReturnType<typeof useT>): string {
  return isModelConfigured(model, configured) ? model.label : `${model.label} ${t('storyboard.needsApiKey')}`;
}

function FrameThumb({ frame, url }: { frame: StoryboardFrameRef; url: string }) {
  return <img className={styles.shotFrameThumb} src={url} alt="" />;
}

export function ShotCard(props: ShotCardProps) {
  const {
    shot,
    index,
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
    onFieldChange,
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
      <header className={styles.shotCardHead}>
        <span className={styles.shotCardIndex}>{t('storyboard.shotLabel', { number: index + 1 })}</span>
        <div className={styles.shotCardHeadActions}>
          <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label={t('storyboard.moveShotUp')}>
            <Icon name="chevron-left" size={14} />
          </button>
          <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label={t('storyboard.moveShotDown')}>
            <Icon name="chevron-right" size={14} />
          </button>
          <button type="button" onClick={onDuplicate} aria-label={t('storyboard.duplicateShot')}>
            <Icon name="copy" size={14} />
          </button>
          <button type="button" onClick={onDelete} aria-label={t('storyboard.deleteShot')}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      </header>

      <div className={styles.shotFrames}>
        <div className={styles.shotFrameSlot}>
          <span className={styles.shotFrameSlotLabel}>{t('storyboard.startFrame')}</span>
          {shot.startFrame ? (
            <>
              <FrameThumb frame={shot.startFrame} url={frameUrl(shot.startFrame.path)} />
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
              </div>
            </>
          ) : (
            <div className={styles.shotFrameActions}>
              <Button
                type="button"
                variant="primary-ghost"
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
            </div>
          )}
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

        <div className={styles.shotFrameSlot}>
          <span className={styles.shotFrameSlotLabel}>{t('storyboard.endFrame')}</span>
          {shot.endFrame ? (
            <FrameThumb frame={shot.endFrame} url={frameUrl(shot.endFrame.path)} />
          ) : supportsKeyframePairs ? (
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

      <textarea
        className={styles.motionPromptInput}
        placeholder={t('storyboard.motionPromptPlaceholder')}
        value={shot.motionPrompt}
        onChange={(e) => onFieldChange({ motionPrompt: e.target.value })}
        data-testid="motion-prompt-input"
      />

      <div className={styles.renderControls}>
        <select
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
          value={shot.durationSec}
          onChange={(e) => onFieldChange({ durationSec: Number(e.target.value) })}
          aria-label={t('storyboard.duration')}
        >
          {STORYBOARD_DURATION_OPTIONS.map((sec) => (
            <option key={sec} value={sec}>{sec}s</option>
          ))}
        </select>
        <Button
          type="button"
          variant="primary"
          disabled={!state.canRender || busy}
          onClick={onRender}
          data-testid="render-shot-button"
          title={state.renderDisabledReason ?? undefined}
        >
          {state.isRendering ? t('storyboard.rendering') : t('storyboard.render')}
        </Button>
      </div>

      {shot.status === 'rendering' ? (
        <p className={styles.shotStatusLine}>{t('storyboard.rendering')}</p>
      ) : shot.status === 'failed' ? (
        <p className={`${styles.shotStatusLine} ${styles.shotStatusError}`}>{shot.error || t('storyboard.renderFailed')}</p>
      ) : shot.status === 'done' && shot.output ? (
        <video className={styles.shotVideoPreview} src={frameUrl(shot.output)} controls muted loop />
      ) : null}
    </article>
  );
}
