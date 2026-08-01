// Storyboard editor: title/ratio header, the mood-exploration lane, the
// ordered shot lane, and a footer bar for assemble / export / reveal.
// Owns the storyboard's in-memory state and persists it via PATCH
// /api/storyboards/:id; individual shot cards stay presentational (see
// ShotCard.tsx).

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Storyboard, StoryboardFrameRef, StoryboardShot } from '@open-design/contracts';
import { Button, VisuallyHidden } from '@open-design/components';
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
  readFileAsDataUrl,
  renderStoryboardShot,
  storyboardFrameUrl,
  uploadStoryboardFrame,
  waitForMediaTask,
} from '../../providers/registry';
import {
  type ConfiguredProviderMap,
  defaultConfiguredModel,
  defaultMoodLaneModel,
  i2iCapableImageModels,
  resolutionForModelId,
  STORYBOARD_DEFAULT_DURATION_SEC,
  STORYBOARD_UPLOAD_ACCEPT,
  validateStoryboardUploadFile,
} from './model-defaults';
import { MoodLane } from './MoodLane';
import { ShotDetailsDrawer } from './ShotDetailsDrawer';
import { ShotRow } from './ShotRow';
import { ShotStartOptions } from './ShotStartOptions';
import { appendShotIfAbsent, persistStoryboardMutation, type StoryboardMutator } from './storyboard-persist';
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

/**
 * Wraps the result of appendShotIfAbsent back into a full Storyboard,
 * returning `prev` itself (same reference) when the shots array didn't
 * change — lets runMutation's own `next === base` check skip a redundant
 * PATCH entirely when the append was a no-op.
 */
function withShots(prev: Storyboard, shots: StoryboardShot[]): Storyboard {
  return shots === prev.shots ? prev : { ...prev, shots };
}

export function StoryboardEditor({ storyboard: initial, configured, onBack }: StoryboardEditorProps) {
  const t = useT();
  const [storyboard, setStoryboard] = useState<Storyboard>(initial);
  const [title, setTitle] = useState(initial.title);
  const [busyShotIds, setBusyShotIds] = useState<Set<string>>(() => new Set());
  const [footerBusy, setFooterBusy] = useState<'assemble' | 'export' | null>(null);
  const [footerMessage, setFooterMessage] = useState<string | null>(null);
  // State for the shot-list-level "Add shots from images" tile — kept
  // separate from footerBusy/footerMessage above (those are assemble/export
  // specific) and from busyShotIds (which gates existing per-shot cards, not
  // a tile that doesn't correspond to any shot yet).
  const [shotsUploadBusy, setShotsUploadBusy] = useState(false);
  const [shotsUploadError, setShotsUploadError] = useState<string | null>(null);
  const [shotsDragOver, setShotsDragOver] = useState(false);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which shot's full editor should be OPEN in the ShotDetailsDrawer — at
  // most one at a time (PRD C4 outcome 1). `showMoreStartOptions` is the
  // "collapsed to a small menu" state for the template/brief starters once
  // shots already exist (outcome 2) — always shown, uncollapsed, on a
  // genuinely empty storyboard instead.
  const [openShotId, setOpenShotId] = useState<string | null>(null);
  // Which shot's drawer is actually RENDERED — lags openShotId by one exit
  // animation (react review R8/R9) so ShotDetailsDrawer gets to play its
  // exit transition instead of being unmounted synchronously the instant
  // openShotId clears (AGENTS.md "keep mounted, toggle a class"). Synced to
  // openShotId immediately on open (see the effect below); on close it stays
  // put until ShotDetailsDrawer's own onExited fires.
  const [renderedShotId, setRenderedShotId] = useState<string | null>(null);
  const [showMoreStartOptions, setShowMoreStartOptions] = useState(false);

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

  // Sync renderedShotId to openShotId immediately when OPENING (or
  // switching directly from one shot's drawer to another's) — only closing
  // lags, driven by ShotDetailsDrawer's own onExited once its exit
  // animation finishes (see the state's doc comment above).
  useEffect(() => {
    if (openShotId) setRenderedShotId(openShotId);
  }, [openShotId]);

  const handleDrawerExited = useCallback(() => setRenderedShotId(null), []);

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
  // defaultMoodLaneModel prefers a configured/ready higgsfield/seedance_2_0_mini
  // over the cheap-first sort below (issue #25); it falls back to the same
  // defaultConfiguredModel cheap-first pick otherwise.
  const defaultMoodModel = useMemo(
    () => defaultMoodLaneModel(moodModels, configured) ?? moodModels[0],
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
    runMutation((prev) => withShots(prev, appendShotIfAbsent(prev.shots, { ...shot, order: prev.shots.length })));
  }

  /**
   * Shared by ShotStartOptions' "from a template" tiles and its "from a
   * brief" box (PRD C4 outcome 2) — both just seed a new shot's
   * motionPrompt up front instead of leaving it blank, then reuse the exact
   * same append mutator `addShot` above does. No daemon/provider change:
   * the frame still gets attached afterward via the normal generate/upload
   * flow in the shot's details drawer.
   */
  function addShotFromPrompt(motionPrompt: string) {
    const model = defaultVideoModel?.id ?? '';
    const shot = { ...newShot(0, model), motionPrompt };
    runMutation((prev) => withShots(prev, appendShotIfAbsent(prev.shots, { ...shot, order: prev.shots.length })));
  }

  /**
   * At most one shot's details drawer is open at a time; toggling the
   * already-open shot closes it. Focus capture/restore on open/close now
   * lives in ShotDetailsDrawer itself (react review R6), not here.
   *
   * Wrapped in useCallback with a stable identity (react review R3): passed
   * straight through as ShotRow's onToggleDetails prop, so every row shares
   * the SAME function reference across renders instead of each row getting
   * a fresh per-render closure — a prerequisite for React.memo(ShotRow) to
   * actually skip re-rendering rows a status flip didn't touch. Uses the
   * functional setState form (not a read of `openShotId` from the closure)
   * so it never goes stale despite the empty dependency array.
   */
  const toggleShotDetails = useCallback((shotId: string) => {
    setOpenShotId((current) => (current === shotId ? null : shotId));
  }, []);

  const closeShotDetails = useCallback(() => setOpenShotId(null), []);

  /**
   * React review R7: if the shot the drawer is currently open for stops
   * existing (deleted while its details were open), close the drawer
   * instead of leaving openShotId pointing at nothing.
   */
  useEffect(() => {
    if (openShotId && !orderedShots.some((s) => s.id === openShotId)) {
      closeShotDetails();
    }
  }, [openShotId, orderedShots, closeShotDetails]);

  // The three mutators below all take a shotId and resolve the CURRENT shot
  // (if needed) from storyboardRef.current rather than closing over a shot
  // object captured at render time — same reasoning as runMutation's own
  // "always the latest doc" doc comment above. That's what lets them be
  // wrapped in useCallback with an empty dependency array and stay
  // reference-stable forever (react review R3), which is what lets
  // React.memo(ShotRow) actually skip untouched rows.
  const duplicateShot = useCallback((shotId: string) => {
    const shot = storyboardRef.current.shots.find((s) => s.id === shotId);
    if (!shot) return;
    const newId = crypto.randomUUID();
    runMutation((prev) =>
      withShots(
        prev,
        appendShotIfAbsent(prev.shots, {
          ...shot,
          id: newId,
          order: prev.shots.length,
          status: 'draft',
          taskId: undefined,
          output: undefined,
          error: undefined,
        }),
      ),
    );
  }, []);

  const deleteShot = useCallback((shotId: string) => {
    runMutation((prev) => {
      const remaining = prev.shots
        .filter((s) => s.id !== shotId)
        .sort((a, b) => a.order - b.order)
        .map((s, i) => ({ ...s, order: i }));
      return { ...prev, shots: remaining };
    });
  }, []);

  const moveShot = useCallback((shotId: string, direction: -1 | 1) => {
    runMutation((prev) => {
      const sorted = [...prev.shots].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((s) => s.id === shotId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= sorted.length) return prev;
      [sorted[index], sorted[target]] = [sorted[target]!, sorted[index]!];
      const reordered = sorted.map((s, i) => ({ ...s, order: i }));
      return { ...prev, shots: reordered };
    });
  }, []);
  const moveShotUp = useCallback((shotId: string) => moveShot(shotId, -1), [moveShot]);
  const moveShotDown = useCallback((shotId: string) => moveShot(shotId, 1), [moveShot]);

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
        // status:'failed' is what actually makes ShotCard render `error`
        // (its status==='failed' gate) — error alone is silently invisible.
        updateShot(shotId, { status: 'failed', error: result.message });
        return;
      }
      const snap = await waitForMediaTask(result.value.taskId);
      if (!aliveRef.current) return;
      if (snap.status !== 'done') {
        updateShot(shotId, { status: 'failed', error: snap.error?.message || t('storyboard.renderFailed') });
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

  // Uploaded frames carry no prompt/model (both optional on
  // StoryboardFrameRef) — newFrameRef stores those fields verbatim, and an
  // uploaded image has neither, so a plain literal is used here instead to
  // avoid persisting bogus empty-string prompt/model onto the ref.
  async function runUpload(shotId: string, slot: 'start' | 'end', file: File) {
    setShotBusy(shotId, true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { path } = await uploadStoryboardFrame(storyboardRef.current.id, dataUrl);
      if (!aliveRef.current) return;
      const frameRef: StoryboardFrameRef = { path, origin: 'uploaded' };
      // Clears any previous failed-upload state so a stale error/status
      // doesn't linger once a later upload attempt succeeds.
      updateShot(shotId, slot === 'end' ? { endFrame: frameRef, status: 'draft', error: undefined } : { startFrame: frameRef, status: 'draft', error: undefined });
    } catch (err) {
      if (!aliveRef.current) return;
      // status:'failed' is what actually makes ShotCard render `error` (see
      // its status==='failed' gate) — same shape runFrameGeneration and
      // handleRenderShot's own failure branch below use, since an upload is
      // a discrete pass/fail action a user needs to see and can retry, same
      // as a render.
      updateShot(shotId, { status: 'failed', error: err instanceof Error ? err.message : t('storyboard.uploadFailed') });
    } finally {
      setShotBusy(shotId, false);
    }
  }

  function handleUploadFile(shotId: string, slot: 'start' | 'end', file: File) {
    const invalid = validateStoryboardUploadFile(file);
    if (invalid) {
      updateShot(shotId, {
        status: 'failed',
        error: invalid === 'too-large' ? t('storyboard.uploadErrorTooLarge') : t('storyboard.uploadErrorBadType'),
      });
      return;
    }
    void runUpload(shotId, slot, file);
  }

  /** Validates every file, uploads the valid ones sequentially, and appends one new shot per successful upload. Skipped files are named in one aggregate message rather than one error per file. */
  async function handleAddShotsFromImages(files: File[]) {
    const validFiles: File[] = [];
    const invalidNames: string[] = [];
    for (const file of files) {
      if (validateStoryboardUploadFile(file) === null) validFiles.push(file);
      else invalidNames.push(file.name);
    }
    setShotsUploadError(invalidNames.length > 0 ? t('storyboard.uploadSkippedSome', { files: invalidNames.join(', ') }) : null);
    if (validFiles.length === 0) return;

    setShotsUploadBusy(true);
    try {
      for (const file of validFiles) {
        const dataUrl = await readFileAsDataUrl(file);
        const { path } = await uploadStoryboardFrame(storyboardRef.current.id, dataUrl);
        if (!aliveRef.current) return;
        const model = defaultVideoModel?.id ?? '';
        const shot = newShot(0, model);
        runMutation((prev) =>
          withShots(
            prev,
            appendShotIfAbsent(prev.shots, { ...shot, order: prev.shots.length, startFrame: { path, origin: 'uploaded' } }),
          ),
        );
      }
    } catch (err) {
      if (!aliveRef.current) return;
      setShotsUploadError(err instanceof Error ? err.message : t('storyboard.uploadFailed'));
    } finally {
      if (aliveRef.current) setShotsUploadBusy(false);
    }
  }

  function handleMultiFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) void handleAddShotsFromImages(files);
  }

  function handleShotsDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setShotsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void handleAddShotsFromImages(files);
  }

  /**
   * Takes a shotId (not a shot object) and useCallback-wrapped with an
   * empty dependency array so it stays reference-stable forever (react
   * review R3) — passed directly as ShotRow's onRender prop instead of a
   * fresh `() => handleRender(shot)` closure built per row per render.
   */
  const handleRenderShot = useCallback(async (shotId: string) => {
    setShotBusy(shotId, true);
    try {
      const result = await renderStoryboardShot(storyboardRef.current.id, shotId);
      if (!aliveRef.current) return;
      if (!result.ok) {
        updateShot(shotId, { status: 'failed', error: result.message });
        return;
      }
      updateShot(shotId, { status: 'rendering', taskId: result.value.taskId, error: undefined });
      const snap = await waitForMediaTask(result.value.taskId);
      if (!aliveRef.current) return;
      if (snap.status === 'done') {
        updateShot(shotId, { status: 'done', output: snap.file?.name, error: undefined });
      } else {
        updateShot(shotId, { status: 'failed', error: snap.error?.message || t('storyboard.renderFailed') });
      }
    } finally {
      setShotBusy(shotId, false);
    }
  }, []);

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

  // Rendered in two places depending on whether the storyboard has any
  // shots yet (see the empty-state vs. populated branches below) — computed
  // once so neither branch duplicates this JSX. Grok design critique G8:
  // the "More ways to start" toggle now sits beside "+ Add shot" (not
  // opposite the section heading), so the whole "blank vs. template vs.
  // brief" choice reads as one group instead of two disconnected controls.
  const quickAddControls = (
    <div className={styles.shotQuickAdd}>
      <button type="button" className={styles.addShotButton} onClick={addShot}>
        <Icon name="plus" size={16} />
        {t('storyboard.addShot')}
      </button>
      <button
        type="button"
        className={`${styles.addShotsButton}${shotsDragOver ? ` ${styles.addShotsButtonDragOver}` : ''}`}
        data-testid="add-shots-from-images"
        disabled={shotsUploadBusy}
        onClick={() => multiFileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!shotsUploadBusy) setShotsDragOver(true); }}
        onDragLeave={() => setShotsDragOver(false)}
        onDrop={handleShotsDrop}
      >
        <Icon name="upload" size={16} />
        {t('storyboard.addShotsFromImages')}
        <span className={styles.addShotsButtonHint}>{t('storyboard.dropImageHint')}</span>
      </button>
      <input
        ref={multiFileInputRef}
        type="file"
        accept={STORYBOARD_UPLOAD_ACCEPT}
        multiple
        className={styles.hiddenFileInput}
        data-testid="add-shots-from-images-input"
        onChange={handleMultiFileInputChange}
      />
      {orderedShots.length > 0 ? (
        <button
          type="button"
          className={styles.moreStartOptionsToggle}
          aria-expanded={showMoreStartOptions}
          aria-controls="shot-start-options-panel"
          onClick={() => setShowMoreStartOptions((v) => !v)}
          data-testid="toggle-start-options"
        >
          {t('storyboard.moreWaysToStart')}
          <Icon name="chevron-down" size={12} />
        </button>
      ) : null}
    </div>
  );

  // React review R8/R9: the drawer stays RENDERED (renderedShotId) through
  // its own exit animation even after openShotId clears — `open` tells it
  // which of those two states it's currently in.
  const drawerShot = renderedShotId ? orderedShots.find((s) => s.id === renderedShotId) ?? null : null;
  const drawerShotIndex = drawerShot ? orderedShots.indexOf(drawerShot) : -1;
  const drawerOpen = drawerShot !== null && openShotId === drawerShot.id;

  return (
    <div className={styles.editor}>
      <header className={styles.editorHead}>
        {/* React review R10: a real page-level heading — the visible title
            control below stays an editable input, so this stays
            screen-reader/document-outline only. */}
        <VisuallyHidden role="heading" aria-level={1}>{storyboard.title || t('storyboard.title')}</VisuallyHidden>
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
        defaultModelId={defaultMoodModel?.id}
        configured={configured}
        busy={false}
        hasShots={orderedShots.length > 0}
        frameUrl={storyboardFrameUrl}
        onGenerate={(prompt, model) => void handleMoodGenerate(prompt, model || defaultMoodModel?.id || '')}
      />

      <div className={styles.shotsSection}>
        <div className={styles.shotsSectionHead}>
          <h2 className={styles.shotsHeading}>{t('storyboard.shotsHeading')}</h2>
        </div>

        {orderedShots.length === 0 ? (
          <>
            <p className={styles.emptyShotsHelper}>{t('storyboard.emptyShotsHelper')}</p>
            {/* Grok design critique G1: the quiet 1-2-3 flow line teaching
                the shot lifecycle before any shot exists. */}
            <p className={styles.flowHint}>{t('storyboard.flowHint')}</p>
            <ShotStartOptions onSelectTemplate={addShotFromPrompt} onCreateFromBrief={addShotFromPrompt}>
              {quickAddControls}
            </ShotStartOptions>
          </>
        ) : (
          <>
            <div className={styles.shotList}>
              {orderedShots.map((shot, index) => (
                <ShotRow
                  key={shot.id}
                  shot={shot}
                  index={index}
                  previousShot={index > 0 ? orderedShots[index - 1]! : null}
                  videoModels={videoModels}
                  configured={configured}
                  frameUrl={storyboardFrameUrl}
                  busy={busyShotIds.has(shot.id)}
                  detailsOpen={openShotId === shot.id}
                  onToggleDetails={toggleShotDetails}
                  onRender={handleRenderShot}
                  onDuplicate={duplicateShot}
                  onDelete={deleteShot}
                  onMoveUp={moveShotUp}
                  onMoveDown={moveShotDown}
                  canMoveUp={index > 0}
                  canMoveDown={index < orderedShots.length - 1}
                />
              ))}
            </div>
            {quickAddControls}
            <div id="shot-start-options-panel" className={`accordion-collapsible${showMoreStartOptions ? ' open' : ''}`}>
              <div className="accordion-collapsible-inner">
                <ShotStartOptions onSelectTemplate={addShotFromPrompt} onCreateFromBrief={addShotFromPrompt} />
              </div>
            </div>
          </>
        )}
      </div>
      {shotsUploadError ? <p className={`${styles.shotStatusLine} ${styles.shotStatusError}`}>{shotsUploadError}</p> : null}

      {drawerShot ? (
        <ShotDetailsDrawer
          key={drawerShot.id}
          shot={drawerShot}
          index={drawerShotIndex}
          open={drawerOpen}
          onExited={handleDrawerExited}
          previousShot={drawerShotIndex > 0 ? orderedShots[drawerShotIndex - 1]! : null}
          imageModels={IMAGE_MODELS}
          i2iImageModels={i2iModels.length > 0 ? i2iModels : [defaultImageModel!].filter(Boolean)}
          videoModels={videoModels}
          configured={configured}
          frameUrl={storyboardFrameUrl}
          busy={busyShotIds.has(drawerShot.id)}
          onGenerateStart={(prompt, model) => handleGenerateStart(drawerShot, prompt, model)}
          onIterateStart={(prompt, model) => handleIterateStart(drawerShot, prompt, model)}
          onDeriveEnd={(prompt, model) => handleDeriveEnd(drawerShot, prompt, model)}
          onUsePreviousEndFrame={() => drawerShotIndex > 0 && handleUsePreviousEndFrame(drawerShot, orderedShots[drawerShotIndex - 1]!)}
          onUploadFile={(slot, file) => handleUploadFile(drawerShot.id, slot, file)}
          onFieldChange={(patch) => updateShot(drawerShot.id, patch)}
          onRender={() => void handleRenderShot(drawerShot.id)}
          onClose={closeShotDetails}
        />
      ) : null}

      <footer className={styles.footerBar}>
        {/* Grok design critique e6: Assemble reads as the same-weight
            climax as Create/Render even with zero renders yet — secondary
            until there's actually something to assemble. */}
        <Button
          type="button"
          variant={hasDoneShot ? 'primary' : 'subtle'}
          disabled={!hasDoneShot || footerBusy !== null}
          onClick={() => void handleAssemble()}
        >
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
