// Storyboard style-reference control — the paste-DESIGN.md entry point for
// prompt steering (see StoryboardStyleReference in packages/contracts and
// apps/daemon/src/storyboards/style-reference.ts for the server half).
// A header chip opens a dialog: paste DESIGN.md → the daemon extracts the
// style profile and returns the updated doc; an active reference shows its
// brand name plus palette swatches and can be removed. Extraction lives
// server-side so the CLI and web surfaces share one behavior.

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
  /** Receives the daemon's updated doc after a successful apply/remove. */
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

  function close() {
    setOpen(false);
    setError(null);
    setBusy(false);
  }

  async function apply() {
    if (busy || !designMd.trim()) return;
    setBusy(true);
    setError(null);
    const result = await setStoryboardStyleReference(storyboard.id, designMd);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    onApplied(result.value);
    setDesignMd('');
    close();
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await clearStoryboardStyleReference(storyboard.id);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    onApplied(result.value);
    close();
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
        <Dialog onClose={close} ariaLabelledBy={titleId} closeOnEscape>
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
            <Button variant="ghost" onClick={close}>
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
