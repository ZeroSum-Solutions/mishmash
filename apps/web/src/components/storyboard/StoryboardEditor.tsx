// Storyboard editor: title/ratio header, the mood-exploration lane, the
// ordered shot lane, and a footer bar for assemble / export / reveal.
// Owns the storyboard's in-memory state and persists it via PATCH
// /api/storyboards/:id; individual shot cards stay presentational (see
// ShotCard.tsx).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Storyboard, StoryboardFrameRef, StoryboardShot } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { IMAGE_MODELS, MEDIA_ASPECTS, VIDEO_MODELS, type MediaModel } from '../../media/models';
import { isMediaProviderPickerReady } from '../../media/provider-readiness';
import {
  assembleStoryboard,
  exportStoryboardSlider,
  generateStoryboardFrame,
  openStoryboardFolder,
  patchStoryboard,
  renderStoryboardShot,
  storyboardFrameUrl,
  waitForMediaTask,
} from '../../providers/registry';
import {
  type ConfiguredProviderMap,
  defaultConfiguredModel,
  i2iCapableImageModels,
  resolutionForModelId,
  STORYBOARD_DEFAULT_DURATION_SEC,
} from './model-defaults';
import { MoodLane } from './MoodLane';
import { ShotCard } from './ShotCard';
import { persistStoryboardMutation, type StoryboardMutator } from './storyboard-persist';
import styles from './StoryboardSection.module.css';

export interface StoryboardEditorProps {
  storyboard: Storyboard;
  configured: ConfiguredProviderMap;
  onBack: () => void;
}

function newFrameRef(path: string, origin: StoryboardFrameRef['origin'], prompt: string, model: string): StoryboardFrameRef {
  return { path, origin, prompt, model };
}

function newShot(order: number, model: string): StoryboardShot {
  return {
    id: crypto.randomUUID(),
    order,
    motionPrompt: '',
    model,
    resolution: resolutionForModelId(model),
    durationSec: STORYBOARD_DEFAULT_DURATION_SEC,
    status: 'draft',
  };
}

export function StoryboardEditor({ storyboard: initial, configured, onBack }: StoryboardEditorProps) {
  const t = useT();
  const [storyboard, setStoryboard] = useState<Storyboard>(initial);
  const [title, setTitle] = useState(initial.title);
  const [busyShotIds, setBusyShotIds] = useState<Set<string>>(() => new Set());
  const [footerBusy, setFooterBusy] = useState<'assemble' | 'export' | null>(null);
  const [footerMessage, setFooterMessage] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always-current storyboard doc, independent of React's render/commit
  // timing. Every mutation reads/writes this ref (not the `storyboard`
  // state closure) so an edit queued minutes into a render-poll chain
  // (waitForMediaTask can run 15-25 min) composes onto the LATEST doc
  // instead of silently reverting whatever other shots changed meanwhile.
  const storyboardRef = useRef<Storyboard>(initial);
  // Flips false on unmount so in-flight poll continuations stop mutating
  // state instead of racing a remount or warning on a dead component.
  const aliveRef = useRef(true);

  useEffect(() => {
    storyboardRef.current = initial;
    setStoryboard(initial);
    setTitle(initial.title);
  }, [initial]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // Every i2v-capable model from a provider the daemon can actually dispatch
  // to — not just the narrower 'kf' (Seedance keyframe-pair) subset. A
  // single start-frame i2v render dispatches generically across providers;
  // 'kf' still gates the derive-end-frame affordance + endImage param
  // specifically (see ShotCard.tsx), not list membership here.
  // isMediaProviderPickerReady(provider) with no mediaProviders arg checks
  // only `integrated`, so bfl/replicate/google/kling/midjourney-style
  // placeholder providers never show up as selectable-but-broken.
  const videoModels = useMemo(
    () => VIDEO_MODELS.filter((m) => m.caps?.includes('i2v') && isMediaProviderPickerReady(m.provider)),
    [],
  );
  const i2iModels = useMemo(() => i2iCapableImageModels(IMAGE_MODELS), []);
  const defaultVideoModel = useMemo(
    () => defaultConfiguredModel(videoModels, configured) ?? videoModels[0],
    [videoModels, configured],
  );
  // Cheap mood-draft lane: the t2v subset of the broadened list above,
  // ordered cheapest-first (480p / fast / lite in the id) rather than the
  // old :480p-suffix-only filter (which only ever matched the OpenRouter
  // Seedance variant and silently fell back to the full list otherwise).
  const moodModels = useMemo(() => {
    const t2vModels = videoModels.filter((m) => m.caps?.includes('t2v'));
    const isCheap = (m: MediaModel) => /480p|fast|lite/i.test(m.id);
    return [...t2vModels].sort((a, b) => Number(isCheap(b)) - Number(isCheap(a)));
  }, [videoModels]);
  const defaultMoodModel = useMemo(
    () => defaultConfiguredModel(moodModels, configured) ?? moodModels[0],
    [moodModels, configured],
  );
  const defaultImageModel = useMemo(
    () => defaultConfiguredModel(IMAGE_MODELS, configured) ?? IMAGE_MODELS[0],
    [configured],
  );

  const orderedShots = useMemo(
    () => [...storyboard.shots].sort((a, b) => a.order - b.order),
    [storyboard.shots],
  );
  const hasDoneShot = orderedShots.some((s) => s.status === 'done' && s.output);

  function setShotBusy(shotId: string, busy: boolean) {
    if (!aliveRef.current) return;
    setBusyShotIds((prev) => {
      if (prev.has(shotId) === busy) return prev;
      const next = new Set(prev);
      if (busy) next.add(shotId);
      else next.delete(shotId);
      return next;
    });
  }

  /**
   * Applies `mutator` to the LATEST known doc (storyboardRef, never the
   * `storyboard` state closure) for an immediate optimistic UI update, then
   * persists it via storyboard-persist.ts — which retries once against the
   * server's current doc on a 409 (see PatchStoryboardRequest.expectedUpdatedAt).
   * Two concurrent mutations (e.g. editing two different shots, or an edit
   * landing while a 15-25 min render poll is still in flight) each read the
   * freshest ref at call time, so neither reverts the other.
   */
  function runMutation(mutator: StoryboardMutator) {
    const base = storyboardRef.current;
    const next = mutator(base);
    if (next === base) return;
    storyboardRef.current = next;
    setStoryboard(next);
    void persistStoryboardMutation(base.id, base, mutator, patchStoryboard).then((result) => {
      if (!aliveRef.current) return;
      if (result.ok) {
        storyboardRef.current = result.value;
        setStoryboard(result.value);
      }
      // A non-409 failure (or an unresolved double conflict) leaves the
      // local optimistic doc as-is — matches this editor's pre-existing
      // fire-and-forget persistence style; there's no dedicated per-shot
      // error surface for a background PATCH failure today.
    });
  }

  function scheduleTitleSave(nextTitle: string) {
    setTitle(nextTitle);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      runMutation((prev) => ({ ...prev, title: nextTitle }));
    }, 600);
  }

  function updateShot(shotId: string, patch: Partial<StoryboardShot>) {
    runMutation((prev) => ({
      ...prev,
      shots: prev.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)),
    }));
  }

  function addShot() {
    const model = defaultVideoModel?.id ?? '';
    const shot = newShot(0, model);
    runMutation((prev) => ({ ...prev, shots: [...prev.shots, { ...shot, order: prev.shots.length }] }));
  }

  function duplicateShot(shot: StoryboardShot) {
    const newId = crypto.randomUUID();
    runMutation((prev) => ({
      ...prev,
      shots: [
        ...prev.shots,
        {
          ...shot,
          id: newId,
          order: prev.shots.length,
          status: 'draft',
          taskId: undefined,
          output: undefined,
          error: undefined,
        },
      ],
    }));
  }

  function deleteShot(shotId: string) {
    runMutation((prev) => {
      const remaining = prev.shots
        .filter((s) => s.id !== shotId)
        .sort((a, b) => a.order - b.order)
        .map((s, i) => ({ ...s, order: i }));
      return { ...prev, shots: remaining };
    });
  }

  function moveShot(shotId: string, direction: -1 | 1) {
    runMutation((prev) => {
      const sorted = [...prev.shots].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((s) => s.id === shotId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= sorted.length) return prev;
      [sorted[index], sorted[target]] = [sorted[target]!, sorted[index]!];
      const reordered = sorted.map((s, i) => ({ ...s, order: i }));
      return { ...prev, shots: reordered };
    });
  }

  async function runFrameGeneration(
    shotId: string,
    prompt: string,
    model: string,
    sourceImage: string | undefined,
    apply: (framePath: string) => Partial<StoryboardShot>,
  ) {
    setShotBusy(shotId, true);
    try {
      const result = await generateStoryboardFrame(storyboardRef.current.id, { prompt, model, sourceImage });
      if (!aliveRef.current) return;
      if (!result.ok) {
        updateShot(shotId, { error: result.message });
        return;
      }
      const snap = await waitForMediaTask(result.value.taskId);
      if (!aliveRef.current) return;
      if (snap.status !== 'done') {
        updateShot(shotId, { error: snap.error?.message || t('storyboard.renderFailed') });
        return;
      }
      const framePath = snap.file?.name || result.value.framePath;
      updateShot(shotId, apply(framePath));
    } finally {
      setShotBusy(shotId, false);
    }
  }

  function handleGenerateStart(shot: StoryboardShot, prompt: string, model: string) {
    void runFrameGeneration(shot.id, prompt, model, undefined, (framePath) => ({
      startFrame: newFrameRef(framePath, 'generated', prompt, model),
    }));
  }

  function handleIterateStart(shot: StoryboardShot, prompt: string, model: string) {
    void runFrameGeneration(shot.id, prompt, model, shot.startFrame?.path, (framePath) => ({
      startFrame: newFrameRef(framePath, 'derived', prompt, model),
    }));
  }

  function handleDeriveEnd(shot: StoryboardShot, prompt: string, model: string) {
    void runFrameGeneration(shot.id, prompt, model, shot.startFrame?.path, (framePath) => ({
      endFrame: newFrameRef(framePath, 'derived', prompt, model),
    }));
  }

  function handleUsePreviousEndFrame(shot: StoryboardShot, previous: StoryboardShot) {
    if (!previous.endFrame) return;
    updateShot(shot.id, {
      startFrame: { ...previous.endFrame, origin: 'previous-shot' },
    });
  }

  async function handleRender(shot: StoryboardShot) {
    setShotBusy(shot.id, true);
    try {
      const result = await renderStoryboardShot(storyboardRef.current.id, shot.id);
      if (!aliveRef.current) return;
      if (!result.ok) {
        updateShot(shot.id, { status: 'failed', error: result.message });
        return;
      }
      updateShot(shot.id, { status: 'rendering', taskId: result.value.taskId, error: undefined });
      const snap = await waitForMediaTask(result.value.taskId);
      if (!aliveRef.current) return;
      if (snap.status === 'done') {
        updateShot(shot.id, { status: 'done', output: snap.file?.name, error: undefined });
      } else {
        updateShot(shot.id, { status: 'failed', error: snap.error?.message || t('storyboard.renderFailed') });
      }
    } finally {
      setShotBusy(shot.id, false);
    }
  }

  function updateMoodDraft(draftId: string, patch: Partial<Storyboard['moodDrafts'][number]>) {
    runMutation((prev) => ({
      ...prev,
      moodDrafts: prev.moodDrafts.map((d) => (d.id === draftId ? { ...d, ...patch } : d)),
    }));
  }

  async function handleMoodGenerate(prompt: string, model: string) {
    const draftId = crypto.randomUUID();
    runMutation((prev) => ({
      ...prev,
      moodDrafts: [...prev.moodDrafts, { id: draftId, prompt, model, status: 'rendering' as const }],
    }));
    // Mood drafts are cheap 480p t2v renders — same POST /frames dispatch,
    // just surface:'video' instead of the default 'image'.
    const result = await generateStoryboardFrame(storyboardRef.current.id, {
      prompt,
      model,
      surface: 'video',
      durationSec: STORYBOARD_DEFAULT_DURATION_SEC,
    });
    if (!aliveRef.current) return;
    if (!result.ok) {
      updateMoodDraft(draftId, { status: 'failed', error: result.message });
      return;
    }
    const snap = await waitForMediaTask(result.value.taskId);
    if (!aliveRef.current) return;
    if (snap.status === 'done') {
      updateMoodDraft(draftId, { status: 'done', output: snap.file?.name });
    } else {
      updateMoodDraft(draftId, { status: 'failed', error: snap.error?.message || t('storyboard.renderFailed') });
    }
  }

  async function handleAssemble() {
    setFooterBusy('assemble');
    setFooterMessage(null);
    const result = await assembleStoryboard(storyboardRef.current.id);
    if (!aliveRef.current) return;
    setFooterMessage(result.ok ? t('storyboard.assembleDone', { file: result.value.output }) : result.message);
    setFooterBusy(null);
  }

  async function handleExportSlider() {
    setFooterBusy('export');
    setFooterMessage(null);
    const result = await exportStoryboardSlider(storyboardRef.current.id);
    if (!aliveRef.current) return;
    setFooterMessage(result.ok ? t('storyboard.exportDone', { file: result.value.output }) : result.message);
    setFooterBusy(null);
  }

  return (
    <div className={styles.editor}>
      <header className={styles.editorHead}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label={t('storyboard.back')}>
          <Icon name="arrow-left" size={16} />
        </button>
        <input
          className={styles.titleInput}
          value={title}
          onChange={(e) => scheduleTitleSave(e.target.value)}
        />
        <select
          value={storyboard.ratio}
          onChange={(e) => { const ratio = e.target.value; runMutation((prev) => ({ ...prev, ratio })); }}
          aria-label={t('storyboard.ratio')}
        >
          {MEDIA_ASPECTS.map((ratio) => (
            <option key={ratio} value={ratio}>{ratio}</option>
          ))}
        </select>
      </header>

      <MoodLane
        drafts={storyboard.moodDrafts}
        models={moodModels}
        configured={configured}
        busy={false}
        frameUrl={storyboardFrameUrl}
        onGenerate={(prompt, model) => void handleMoodGenerate(prompt, model || defaultMoodModel?.id || '')}
      />

      <div className={styles.shotLane}>
        {orderedShots.map((shot, index) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            index={index}
            previousShot={index > 0 ? orderedShots[index - 1]! : null}
            imageModels={IMAGE_MODELS}
            i2iImageModels={i2iModels.length > 0 ? i2iModels : [defaultImageModel!].filter(Boolean)}
            videoModels={videoModels}
            configured={configured}
            frameUrl={storyboardFrameUrl}
            busy={busyShotIds.has(shot.id)}
            onGenerateStart={(prompt, model) => handleGenerateStart(shot, prompt, model)}
            onIterateStart={(prompt, model) => handleIterateStart(shot, prompt, model)}
            onDeriveEnd={(prompt, model) => handleDeriveEnd(shot, prompt, model)}
            onUsePreviousEndFrame={() => index > 0 && handleUsePreviousEndFrame(shot, orderedShots[index - 1]!)}
            onFieldChange={(patch) => updateShot(shot.id, patch)}
            onRender={() => void handleRender(shot)}
            onDuplicate={() => duplicateShot(shot)}
            onDelete={() => deleteShot(shot.id)}
            onMoveUp={() => moveShot(shot.id, -1)}
            onMoveDown={() => moveShot(shot.id, 1)}
            canMoveUp={index > 0}
            canMoveDown={index < orderedShots.length - 1}
          />
        ))}
        <button type="button" className={styles.addShotButton} onClick={addShot}>
          <Icon name="plus" size={16} />
          {t('storyboard.addShot')}
        </button>
      </div>

      <footer className={styles.footerBar}>
        <Button type="button" variant="primary" disabled={!hasDoneShot || footerBusy !== null} onClick={() => void handleAssemble()}>
          {footerBusy === 'assemble' ? t('storyboard.assembling') : t('storyboard.assemble')}
        </Button>
        <Button type="button" variant="subtle" disabled={footerBusy !== null} onClick={() => void handleExportSlider()}>
          {footerBusy === 'export' ? t('storyboard.exporting') : t('storyboard.exportSlider')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void openStoryboardFolder(storyboard.id)}>
          {t('storyboard.openFolder')}
        </Button>
        {footerMessage ? <span className={styles.footerMessage}>{footerMessage}</span> : null}
      </footer>
    </div>
  );
}
