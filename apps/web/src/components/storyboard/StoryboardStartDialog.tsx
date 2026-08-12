import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { CreateStoryboardRequest, StoryboardCommercialBrief } from '@open-design/contracts';
import { Button } from '@open-design/components';

import { useT } from '../../i18n';
import styles from './StoryboardSection.module.css';

interface StoryboardStartDialogProps {
  busy: boolean;
  error: string | null;
  onCreate: (request: CreateStoryboardRequest) => void;
  onClose: () => void;
}

const EMPTY_BRIEF: StoryboardCommercialBrief = {
  productName: '',
  audience: '',
  promise: '',
  visualDirection: '',
  callToAction: '',
};

export function StoryboardStartDialog({ busy, error, onCreate, onClose }: StoryboardStartDialogProps) {
  const t = useT();
  const [brief, setBrief] = useState(EMPTY_BRIEF);
  const [ratio, setRatio] = useState('16:9');
  const complete = Object.values(brief).every((value) => value.trim().length > 0);

  function update(field: keyof StoryboardCommercialBrief, value: string) {
    setBrief((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || busy) return;
    onCreate({
      recipe: 'hero-product-commercial',
      ratio,
      commercialBrief: {
        productName: brief.productName.trim(),
        audience: brief.audience.trim(),
        promise: brief.promise.trim(),
        visualDirection: brief.visualDirection.trim(),
        callToAction: brief.callToAction.trim(),
      },
    });
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.startDialogBackdrop} role="presentation">
      <section
        className={styles.startDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="storyboard-start-title"
        aria-describedby="storyboard-start-intro"
        onKeyDown={handleDialogKeyDown}
      >
        <div className={styles.startDialogHead}>
          <div>
            <h2 id="storyboard-start-title">{t('storyboard.startDialogTitle')}</h2>
            <p id="storyboard-start-intro">{t('storyboard.startDialogIntro')}</p>
          </div>
          <button type="button" className={styles.startDialogClose} onClick={onClose} aria-label={t('storyboard.cancel')}>
            ×
          </button>
        </div>

        <div className={styles.recipeCard}>
          <div>
            <span className={styles.recipeRecommended}>{t('storyboard.recipeRecommended')}</span>
            <h3>{t('storyboard.recipeHeroTitle')}</h3>
            <p>{t('storyboard.recipeHeroDescription')}</p>
          </div>
          <ol className={styles.recipeSteps}>
            <li>{t('storyboard.recipeStepImages')}</li>
            <li>{t('storyboard.recipeStepTakes')}</li>
            <li>{t('storyboard.recipeStepChoose')}</li>
            <li>{t('storyboard.recipeStepAssemble')}</li>
          </ol>
        </div>

        <form className={styles.startDialogForm} onSubmit={submit}>
          <label>
            <span>{t('storyboard.briefProduct')}</span>
            <input
              autoFocus
              required
              maxLength={120}
              value={brief.productName}
              onChange={(event) => update('productName', event.target.value)}
            />
          </label>
          <label>
            <span>{t('storyboard.briefAudience')}</span>
            <input required maxLength={240} value={brief.audience} onChange={(event) => update('audience', event.target.value)} />
          </label>
          <label>
            <span>{t('storyboard.briefPromise')}</span>
            <input required maxLength={240} value={brief.promise} onChange={(event) => update('promise', event.target.value)} />
          </label>
          <label>
            <span>{t('storyboard.briefDirection')}</span>
            <textarea
              required
              maxLength={500}
              rows={2}
              value={brief.visualDirection}
              onChange={(event) => update('visualDirection', event.target.value)}
            />
          </label>
          <label>
            <span>{t('storyboard.briefCta')}</span>
            <input
              required
              maxLength={240}
              value={brief.callToAction}
              onChange={(event) => update('callToAction', event.target.value)}
            />
          </label>
          <label>
            <span>{t('storyboard.briefRatio')}</span>
            <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
              <option value="16:9">16:9 · {t('storyboard.ratioLandscape')}</option>
              <option value="9:16">9:16 · {t('storyboard.ratioVertical')}</option>
              <option value="1:1">1:1 · {t('storyboard.ratioSquare')}</option>
            </select>
          </label>

          {error ? <p className={styles.startDialogError}>{error}</p> : null}
          <div className={styles.startDialogActions}>
            <Button type="submit" variant="primary" disabled={!complete || busy}>
              {busy ? t('storyboard.creating') : t('storyboard.createCommercial')}
            </Button>
            <Button type="button" variant="subtle" disabled={busy} onClick={() => onCreate({})}>
              {t('storyboard.startBlankInstead')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
