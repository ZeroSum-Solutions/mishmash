// The shots empty-state / "more ways to start" entry points (PRD C4 outcome
// 2): a couple of canned motion-prompt templates, a one-line "brief" that
// seeds a single new shot's motion prompt directly (purely client-side, no
// daemon/provider change), and — in the same brief column — a "draft the
// whole storyboard" action that sends that brief to the daemon (POST
// /api/storyboards/:id/draft-shots) to draft several shots at once. Blank-shot
// and add-shots-from-images stay StoryboardEditor's own existing controls
// (unchanged); the caller passes them in as `children` for the third "start
// blank" column so this component only owns the brief/template/draft paths.

import { useId, useState, type ReactNode } from 'react';
import {
  STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT,
  STORYBOARD_DRAFT_SHOT_COUNT_MAX,
  STORYBOARD_DRAFT_SHOT_COUNT_MIN,
} from '@open-design/contracts';
import { Button, Input, Textarea } from '@open-design/components';
import { useT } from '../../i18n';
import { SHOT_TEMPLATES } from './shot-templates';
import styles from './ShotStartOptions.module.css';

export interface ShotStartOptionsProps {
  onSelectTemplate: (motionPrompt: string) => void;
  onCreateFromBrief: (brief: string) => void;
  /**
   * Drafts several shots at once from the same brief text (as opposed to
   * onCreateFromBrief's single shot) — POST /api/storyboards/:id/draft-shots
   * on the caller's side. `shotCount` is bounded by
   * STORYBOARD_DRAFT_SHOT_COUNT_MIN/MAX below.
   *
   * Resolves `true` once the daemon call actually succeeds, `false`
   * otherwise (NO_TEXT_PROVIDER, UPSTREAM_UNAVAILABLE, 409, network error).
   * submitDraft awaits this and only clears the typed brief on `true` — the
   * brief is a synchronous client-only mutation on the sibling
   * onCreateFromBrief path (safe to clear immediately there), but this path
   * is an async daemon round trip, so clearing eagerly would destroy up to
   * 4000 chars of user text on failure with no retry affordance.
   */
  onDraftStoryboard: (brief: string, shotCount: number) => Promise<boolean>;
  /** True while the caller's draft-shots request is in flight. */
  draftBusy?: boolean;
  /** Daemon-supplied error text (e.g. NO_TEXT_PROVIDER) — rendered as-is. */
  draftError?: string | null;
  /**
   * Informational outcome of a SUCCESSFUL draft — currently a shortfall
   * notice when the model returned fewer shots than asked for. Kept separate
   * from draftError so a successful-but-partial draft is not dressed up as a
   * failure in danger styling with an assertive role="alert".
   */
  draftNotice?: string | null;
  children?: ReactNode;
}

function clampShotCount(value: number): number {
  if (!Number.isFinite(value)) return STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT;
  return Math.min(STORYBOARD_DRAFT_SHOT_COUNT_MAX, Math.max(STORYBOARD_DRAFT_SHOT_COUNT_MIN, Math.round(value)));
}

export function ShotStartOptions({
  onSelectTemplate,
  onCreateFromBrief,
  onDraftStoryboard,
  draftBusy = false,
  draftError = null,
  draftNotice = null,
  children,
}: ShotStartOptionsProps) {
  const t = useT();
  const [brief, setBrief] = useState('');
  const [shotCount, setShotCount] = useState(STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT);
  // React review R1: the brief Textarea had no accessible name — wire it to
  // the visible column label instead of guessing at a standalone aria-label.
  const briefLabelId = useId();

  function submitBrief() {
    const trimmed = brief.trim();
    if (!trimmed) return;
    onCreateFromBrief(trimmed);
    setBrief('');
  }

  async function submitDraft() {
    const trimmed = brief.trim();
    if (!trimmed) return;
    const succeeded = await onDraftStoryboard(trimmed, shotCount);
    if (succeeded) setBrief('');
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
              // FIX 2: a template tile appends a shot client-side just like
              // the brief submit button below — disable it while a draft is
              // in flight so it can't race the draft response and get
              // silently overwritten.
              disabled={draftBusy}
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
            // FIX 2 (CRITICAL, client half): this button mutates the same
            // storyboard as an in-flight "Draft storyboard" call
            // (addShotFromPrompt vs. the daemon's draft-shots response) — a
            // click here mid-draft silently vanished once the draft
            // response overwrote local state. Gate on draftBusy too, not
            // just the empty-brief check.
            disabled={!brief.trim() || draftBusy}
            onClick={submitBrief}
            data-testid="shot-brief-submit"
          >
            {t('storyboard.briefCreateShot')}
          </Button>
          {/* Draft the whole storyboard (several shots) from the same brief
              text, instead of just one shot — a separate daemon round trip
              (POST .../draft-shots), so it gets its own busy/error surface. */}
          <div className={styles.briefDraftRow}>
            <label className={styles.draftCountField}>
              <span className={styles.draftCountLabel}>{t('storyboard.draftShotCountLabel')}</span>
              <Input
                type="number"
                min={STORYBOARD_DRAFT_SHOT_COUNT_MIN}
                max={STORYBOARD_DRAFT_SHOT_COUNT_MAX}
                value={shotCount}
                onChange={(e) => setShotCount(clampShotCount(Number(e.target.value)))}
                className={styles.draftCountInput}
                data-testid="shot-draft-count"
              />
            </label>
            <Button
              type="button"
              variant="subtle"
              disabled={!brief.trim() || draftBusy}
              // FIX 4: convey the in-flight request accessibly, matching
              // BrandReferencePicker's per-element aria-busy pattern.
              aria-busy={draftBusy || undefined}
              onClick={submitDraft}
              data-testid="shot-draft-submit"
            >
              {draftBusy ? t('storyboard.draftingStoryboard') : t('storyboard.draftStoryboard')}
            </Button>
          </div>
          {/* FIX 4: match BrandReferencePicker.tsx's established pattern —
              role="alert" for errors, role="status" for status — instead of
              rendering the error with no role at all. */}
          {draftError ? (
            <p className={styles.draftError} role="alert" data-testid="shot-draft-error">
              {draftError}
            </p>
          ) : draftBusy ? (
            <p className={styles.draftStatus} role="status" data-testid="shot-draft-status">
              {t('storyboard.draftingStoryboard')}
            </p>
          ) : draftNotice ? (
            <p className={styles.draftStatus} role="status" data-testid="shot-draft-notice">
              {draftNotice}
            </p>
          ) : null}
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
