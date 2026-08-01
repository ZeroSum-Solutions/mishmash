// Cheap 480p one-shot t2v "mood exploration" lane — a collapsed strip with a
// prompt box, a model picker preset to the cheapest configured 480p t2v
// model, and previous drafts with video previews. Deliberately NOT the same
// quality bar as shot rendering; see `helper` copy below.

import { useEffect, useRef, useState } from 'react';
import type { StoryboardMoodDraft } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { useT } from '../../i18n';
import type { MediaModel } from '../../media/models';
import { type ConfiguredProviderMap, isModelConfigured } from './model-defaults';
import styles from './StoryboardSection.module.css';

export interface MoodLaneProps {
  drafts: StoryboardMoodDraft[];
  models: MediaModel[];
  /** Preselected model id for the picker below — see
   * model-defaults.ts's defaultMoodLaneModel (issue #25: prefers a
   * configured/ready higgsfield/seedance_2_0_mini over the cheap-first
   * `models` order). Falls back to `models[0]` when unset/not found. */
  defaultModelId?: string;
  configured: ConfiguredProviderMap;
  busy: boolean;
  frameUrl: (path: string) => string;
  onGenerate: (prompt: string, model: string) => void;
}

export function MoodLane({ drafts, models, defaultModelId, configured, busy, frameUrl, onGenerate }: MoodLaneProps) {
  const t = useT();
  const [open, setOpen] = useState(drafts.length === 0);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(defaultModelId ?? models[0]?.id ?? '');
  // StoryboardSection's media-provider config fetch resolves asynchronously
  // (see its useEffect), so a fast "New storyboard" click can mount this
  // component before it lands — defaultModelId then arrives as a later prop
  // update rather than being present at mount. Adopt it whenever it changes,
  // but only until the user makes their own pick — set once, a manual
  // selection must never be silently overridden by a subsequent recompute.
  const userSelectedModel = useRef(false);
  useEffect(() => {
    if (userSelectedModel.current) return;
    const next = defaultModelId ?? models[0]?.id ?? '';
    setModel((current) => (current === next ? current : next));
  }, [defaultModelId, models]);

  return (
    <section className={styles.moodLane}>
      <button type="button" className={styles.moodLaneToggle} onClick={() => setOpen((v) => !v)}>
        {t('storyboard.moodLaneTitle')}
      </button>
      {open ? (
        <div className={styles.moodLaneBody}>
          <p className={styles.moodLaneHelper}>{t('storyboard.moodLaneHelper')}</p>
          <div className={styles.moodLaneForm}>
            <textarea
              className={styles.shotDialogTextarea}
              placeholder={t('storyboard.moodPromptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <select
              value={model}
              onChange={(e) => { userSelectedModel.current = true; setModel(e.target.value); }}
              aria-label={t('storyboard.videoModel')}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {isModelConfigured(m, configured) ? m.label : `${m.label} ${t('storyboard.needsApiKey')}`}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="primary"
              disabled={!prompt.trim() || !model || busy}
              onClick={() => { onGenerate(prompt.trim(), model); setPrompt(''); }}
            >
              {t('storyboard.moodGenerate')}
            </Button>
          </div>
          {drafts.length > 0 ? (
            <div className={styles.moodDraftRail}>
              {drafts.map((draft) => (
                <div key={draft.id} className={styles.moodDraftCard} data-testid="mood-draft-card">
                  {draft.status === 'done' && draft.output ? (
                    <video className={styles.moodDraftVideo} src={frameUrl(draft.output)} controls muted loop />
                  ) : draft.status === 'failed' ? (
                    <p className={styles.shotStatusError}>{draft.error || t('storyboard.renderFailed')}</p>
                  ) : (
                    <p className={styles.shotStatusLine}>{t('storyboard.rendering')}</p>
                  )}
                  <p className={styles.moodDraftPrompt}>{draft.prompt}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
