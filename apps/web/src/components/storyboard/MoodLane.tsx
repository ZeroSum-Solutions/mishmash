// Cheap 480p one-shot t2v "mood exploration" lane — a collapsible strip with
// a prompt box, a model picker preset to the cheapest configured 480p t2v
// model, and previous drafts with video previews. Deliberately NOT the same
// quality bar as shot rendering; see `helper` copy below.
//
// PRD C4 outcome 4 ("collapsible inspiration strip... collapses out of the
// way once shots exist"): `hasShots` auto-collapses the lane the first time
// a storyboard goes from zero to one-or-more shots (or is opened with shots
// already in it), the same "adopt until the user overrides it" idiom this
// file already uses for defaultModelId below — a manual toggle always wins
// once the user has touched it.

import { useEffect, useId, useRef, useState } from 'react';
import type { StoryboardMoodDraft } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { Icon } from '../Icon';
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
  /** Whether the storyboard already has at least one shot — see the
   * auto-collapse behavior described above. Defaults to false so existing
   * callers/tests that don't pass it keep today's "start open when there
   * are no drafts yet" behavior. */
  hasShots?: boolean;
  frameUrl: (path: string) => string;
  onGenerate: (prompt: string, model: string) => void;
}

export function MoodLane({ drafts, models, defaultModelId, configured, busy, hasShots = false, frameUrl, onGenerate }: MoodLaneProps) {
  const t = useT();
  const [open, setOpen] = useState(drafts.length === 0 && !hasShots);
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

  // Same "adopt until overridden" idiom as the model picker above: once the
  // first shot appears, collapse the lane — but never fight a manual toggle
  // the user has already made.
  const userToggledOpen = useRef(false);
  useEffect(() => {
    if (userToggledOpen.current) return;
    if (hasShots) setOpen(false);
  }, [hasShots]);

  function toggleOpen() {
    userToggledOpen.current = true;
    setOpen((v) => !v);
  }

  const panelId = useId();

  return (
    <section className={styles.moodLane}>
      {/* Grok design critique G9: collapsed state used to be just the bare
          title bar — an "empty dead slab" that still looked interactive
          and stole scan weight while showing nothing. It now carries a
          one-line teaser and an explicit chevron so the collapsed row
          reads as informative, not broken. */}
      <button
        type="button"
        className={styles.moodLaneToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggleOpen}
        data-testid="mood-lane-toggle"
      >
        <span>{t('storyboard.moodLaneTitle')}</span>
        {!open ? <span className={styles.moodLaneTeaser}>{t('storyboard.moodLaneTeaser')}</span> : null}
        <Icon name="chevron-down" size={14} className={styles.moodLaneChevron} />
      </button>
      <div id={panelId} className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
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
              {/* Grok design critique G1: demoted from primary so it never
                  competes with the Shots section's own primary CTAs as a
                  second "start here" on an empty board. */}
              <Button
                type="button"
                variant="subtle"
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
        </div>
      </div>
    </section>
  );
}
