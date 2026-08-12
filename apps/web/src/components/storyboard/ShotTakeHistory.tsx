import { useState } from 'react';
import type {
  ReviewStoryboardTakeRequest,
  StoryboardTakeReceipt,
  StoryboardTakeReview,
  StoryboardTakeScores,
} from '@open-design/contracts';
import { Button } from '@open-design/components';

import { useT } from '../../i18n';
import styles from './StoryboardSection.module.css';

interface ShotTakeHistoryProps {
  takes: StoryboardTakeReceipt[];
  reviews: Record<string, StoryboardTakeReview>;
  selectedTakeId?: string;
  frameUrl: (path: string) => string;
  onReview: (takeId: string, review: ReviewStoryboardTakeRequest) => void;
}

const DEFAULT_SCORES: StoryboardTakeScores = {
  brandFit: 3,
  motionQuality: 3,
  artifactControl: 3,
  revisionEase: 3,
};

function providerLabel(providerId: string): string {
  if (providerId === 'higgsfield') return 'Higgsfield';
  if (providerId === 'hyperframes') return 'HyperFrames';
  if (providerId === 'openrouter') return 'OpenRouter';
  if (providerId === 'volcengine') return 'Volcengine';
  return providerId === 'unknown' ? 'Provider not reported' : providerId;
}

export function ShotTakeHistory({ takes, reviews, selectedTakeId, frameUrl, onReview }: ShotTakeHistoryProps) {
  const t = useT();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [scores, setScores] = useState<Record<string, StoryboardTakeScores>>({});

  function review(takeId: string, decision: ReviewStoryboardTakeRequest['decision']) {
    const reviewScores = scores[takeId] ?? reviews[takeId]?.scores;
    const reviewNote = notes[takeId] ?? reviews[takeId]?.note;
    onReview(takeId, {
      decision,
      ...(reviewNote?.trim() ? { note: reviewNote.trim() } : {}),
      ...(reviewScores ? { scores: reviewScores } : {}),
    });
  }

  function updateScore(takeId: string, field: keyof StoryboardTakeScores, value: number) {
    setScores((current) => ({
      ...current,
      [takeId]: { ...(current[takeId] ?? DEFAULT_SCORES), [field]: value },
    }));
  }

  return (
    <section className={styles.takeHistory} aria-label={t('storyboard.takesHeading')}>
      <h3>{t('storyboard.takesHeading')}</h3>
      <div className={styles.takeList}>
        {takes.map((take, index) => {
          const savedReview = reviews[take.id];
          const activeScores = scores[take.id] ?? savedReview?.scores ?? DEFAULT_SCORES;
          const selected = selectedTakeId === take.id;
          return (
            <article className={`${styles.takeCard}${selected ? ` ${styles.takeCardSelected}` : ''}`} key={take.id}>
              <div className={styles.takeCardHead}>
                <strong>{t('storyboard.takeLabel', { number: index + 1 })}</strong>
                {selected ? (
                  <span className={styles.takeApproved}>{t('storyboard.takeApproved')}</span>
                ) : savedReview?.decision === 'approved' ? (
                  <span className={styles.takeApproved}>{t('storyboard.takeApprovedNotSelected')}</span>
                ) : savedReview?.decision === 'rejected' ? (
                  <span className={styles.takeRejected}>{t('storyboard.takeRejected')}</span>
                ) : null}
              </div>

              {take.status === 'done' && take.output ? (
                <video className={styles.takeVideo} src={frameUrl(take.output)} controls muted loop preload="metadata" />
              ) : (
                <p className={styles.takeFailure}>{take.error ?? t('storyboard.renderFailed')}</p>
              )}

              <dl className={styles.takeFacts}>
                <div>
                  <dt>{t('storyboard.takeProviderLabel')}</dt>
                  <dd>{providerLabel(take.providerId)}</dd>
                </div>
                <div>
                  <dt>{t('storyboard.takeDurationLabel')}</dt>
                  <dd>{(take.renderDurationMs / 1000).toFixed(1)} seconds</dd>
                </div>
              </dl>
              {take.providerNote ? (
                <p className={styles.takeProviderNote}><strong>{t('storyboard.takeProviderNote')}:</strong> {take.providerNote}</p>
              ) : null}
              {take.warnings?.length ? (
                <div className={styles.takeWarnings}>
                  <strong>{t('storyboard.takeWarnings')}:</strong>
                  <ul>{take.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ) : null}
              <p className={styles.takeDisclosure}>{take.cost.note}</p>
              <p className={styles.takeRights}>{t('storyboard.usageRightsUnverified')}</p>

              <details className={styles.takeNotes}>
                <summary>{t('storyboard.comparisonNotes')}</summary>
                <div className={styles.takeScoreGrid}>
                  {([
                    ['brandFit', 'storyboard.brandFit'],
                    ['motionQuality', 'storyboard.motionQuality'],
                    ['artifactControl', 'storyboard.artifactControl'],
                    ['revisionEase', 'storyboard.revisionEase'],
                  ] as const).map(([field, key]) => (
                    <label key={field}>
                      <span>{t(key)}</span>
                      <select
                        aria-label={t(key)}
                        value={activeScores[field]}
                        onChange={(event) => updateScore(take.id, field, Number(event.target.value))}
                      >
                        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <label className={styles.takeNoteField}>
                  <span>{t('storyboard.reviewNotes')}</span>
                  <textarea
                    aria-label={t('storyboard.reviewNotes')}
                    maxLength={500}
                    value={notes[take.id] ?? savedReview?.note ?? ''}
                    onChange={(event) => setNotes((current) => ({ ...current, [take.id]: event.target.value }))}
                  />
                </label>
              </details>

              <div className={styles.takeActions}>
                <Button
                  type="button"
                  variant="primary"
                  disabled={take.status !== 'done' || !take.output || selected}
                  onClick={() => review(take.id, 'approved')}
                >
                  {t('storyboard.useTake')}
                </Button>
                <Button type="button" variant="subtle" onClick={() => review(take.id, 'rejected')}>
                  {t('storyboard.rejectTake')}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
