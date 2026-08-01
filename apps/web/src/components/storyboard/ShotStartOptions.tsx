// The shots empty-state / "more ways to start" entry points (PRD C4 outcome
// 2): a couple of canned motion-prompt templates, and a one-line "brief"
// that seeds a new shot's motion prompt directly — both purely client-side,
// no daemon/provider change. Blank-shot and add-shots-from-images stay
// StoryboardEditor's own existing controls (unchanged); the caller passes
// them in as `children` for the third "start blank" column so this
// component only owns the two NEW paths.

import { useId, useState, type ReactNode } from 'react';
import { Button, Textarea } from '@open-design/components';
import { useT } from '../../i18n';
import { SHOT_TEMPLATES } from './shot-templates';
import styles from './ShotStartOptions.module.css';

export interface ShotStartOptionsProps {
  onSelectTemplate: (motionPrompt: string) => void;
  onCreateFromBrief: (brief: string) => void;
  children?: ReactNode;
}

export function ShotStartOptions({ onSelectTemplate, onCreateFromBrief, children }: ShotStartOptionsProps) {
  const t = useT();
  const [brief, setBrief] = useState('');
  // React review R1: the brief Textarea had no accessible name — wire it to
  // the visible column label instead of guessing at a standalone aria-label.
  const briefLabelId = useId();

  function submitBrief() {
    const trimmed = brief.trim();
    if (!trimmed) return;
    onCreateFromBrief(trimmed);
    setBrief('');
  }

  return (
    <div className={styles.root}>
      <div className={styles.column}>
        <span className={styles.columnLabel}>{t('storyboard.templateSectionLabel')}</span>
        <div className={styles.templateRow}>
          {SHOT_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className={styles.templateTile}
              onClick={() => onSelectTemplate(t(tpl.motionPromptKey))}
              data-testid={`shot-template-${tpl.id}`}
            >
              {t(tpl.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.column}>
        <span className={styles.columnLabel} id={briefLabelId}>{t('storyboard.briefSectionLabel')}</span>
        <div className={styles.briefForm}>
          <Textarea
            className={styles.briefTextarea}
            placeholder={t('storyboard.briefPlaceholder')}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            aria-labelledby={briefLabelId}
            data-testid="shot-brief-input"
          />
          {/* Grok design critique e4: a filled "primary" Create button made
              this column visually dominate the other two same-weight lanes
              — matches the template tiles' and blank buttons' bordered,
              non-filled treatment now. */}
          <Button
            type="button"
            variant="subtle"
            disabled={!brief.trim()}
            onClick={submitBrief}
            data-testid="shot-brief-submit"
          >
            {t('storyboard.briefCreateShot')}
          </Button>
        </div>
      </div>

      {children ? (
        <div className={styles.column}>
          <span className={styles.columnLabel}>{t('storyboard.blankSectionLabel')}</span>
          {children}
        </div>
      ) : null}
    </div>
  );
}
