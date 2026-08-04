// Storyboard style-reference control — the paste-DESIGN.md entry point for
// prompt steering (see StoryboardStyleReference in packages/contracts and
// apps/daemon/src/storyboards/style-reference.ts for the server half).
// A header chip opens a dialog: paste DESIGN.md → the daemon extracts the
// style profile and returns the updated doc; an active reference shows its
// brand name plus palette swatches and can be removed. Extraction lives
// server-side so the CLI and web surfaces share one behavior.
//
// Both mutations send the doc's updatedAt as expectedUpdatedAt: a stale
// dialog (another tab changed the storyboard) gets a 409 with the current
// doc, which is resynced into the editor via onApplied so the retry starts
// fresh instead of silently overwriting the other client's write.

import { useId, useState } from 'react';
import type { Storyboard } from '@open-design/contracts';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@open-design/components';
import { useT } from '../../i18n';
import {
  clearStoryboardStyleReference,
  setStoryboardStyleReference,
} from '../../providers/registry';
import styles from './StyleReferenceControl.module.css';

export interface StyleReferenceControlProps {
  storyboard: Storyboard;
  /**
   * Receives the daemon's updated doc after a successful apply/remove — and
   * after a 409 conflict, where it carries the OTHER client's current doc so
   * the editor resyncs before the user retries.
   */
  onApplied: (storyboard: Storyboard) => void;
}

export function StyleReferenceControl({ storyboard, onApplied }: StyleReferenceControlProps) {
  const t = useT();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [designMd, setDesignMd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = storyboard.styleReference;

  // User-initiated close (Cancel, Escape, backdrop). A no-op while a
  // mutation is in flight: closing mid-request would let the style land
  // anyway after the dialog is gone — or race a second request on reopen.
  function closeIdle() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  function handleFailure(result: { status?: number; message: string; conflict?: Storyboard }) {
    if (result.status === 409 && result.conflict) {
      // Resync the editor to the other client's doc; the retry then carries
      // a fresh expectedUpdatedAt.
      onApplied(result.conflict);
      setError(t('storyboard.styleReferenceConflict'));
    } else {
      setError(result.message);
    }
    setBusy(false);
  }

  async function apply() {
    if (busy || !designMd.trim()) return;
    setBusy(true);
    setError(null);
    const result = await setStoryboardStyleReference(storyboard.id, designMd, storyboard.updatedAt);
    if (!result.ok) return handleFailure(result);
    onApplied(result.value);
    setDesignMd('');
    setBusy(false);
    setOpen(false);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await clearStoryboardStyleReference(storyboard.id, storyboard.updatedAt);
    if (!result.ok) return handleFailure(result);
    onApplied(result.value);
    setBusy(false);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger}${active ? ` ${styles.triggerActive}` : ''}`}
        data-testid="style-reference-trigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {active
          ? t('storyboard.styleReferenceActive', { name: active.brand.name })
          : t('storyboard.styleReference')}
      </button>
      {open ? (
        <Dialog
          onClose={closeIdle}
          ariaLabelledBy={titleId}
          closeOnEscape={!busy}
          closeOnBackdrop={!busy}
        >
          <DialogHeader>
            <DialogTitle id={titleId}>{t('storyboard.styleReference')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className={styles.hint}>{t('storyboard.styleReferenceHint')}</p>
            {active ? (
              <div className={styles.activeSummary}>
                <span className={styles.activeName}>{active.brand.name}</span>
                <span className={styles.swatches} aria-hidden="true">
                  {active.brand.colors.slice(0, 5).map((color) => (
                    <span
                      key={`${color.role}-${color.hex}`}
                      className={styles.swatch}
                      style={{ backgroundColor: color.hex }}
                      title={`${color.name} ${color.hex}`}
                    />
                  ))}
                </span>
                <Button
                  variant="ghost"
                  data-testid="style-reference-remove"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t('storyboard.styleReferenceRemove')}
                </Button>
              </div>
            ) : null}
            <Textarea
              rows={8}
              value={designMd}
              data-testid="style-reference-input"
              aria-label={t('storyboard.styleReference')}
              placeholder={t('storyboard.styleReferencePlaceholder')}
              onChange={(e) => setDesignMd(e.target.value)}
            />
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={closeIdle}>
              {t('storyboard.cancel')}
            </Button>
            <Button
              variant="primary"
              data-testid="style-reference-apply"
              disabled={busy || !designMd.trim()}
              onClick={() => void apply()}
            >
              {busy ? t('storyboard.styleReferenceApplying') : t('storyboard.styleReferenceApply')}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  );
}
