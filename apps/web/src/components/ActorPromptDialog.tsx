import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog } from '@open-design/components';

import { useT } from '../i18n';
import {
  getStoredActorName,
  hasSeenActorPrompt,
  markActorPromptSeen,
  setStoredActorName,
} from '../runtime/actor-identity';
import styles from './ActorPromptDialog.module.css';

/**
 * One-time "who are you" prompt (F-03 / D-2).
 *
 * INVARIANT: this asks at most once per browser profile and never blocks
 * anything. Skipping is a real answer — attribution is optional under D-2, so a
 * skipped prompt leaves the browser unattributed rather than parking the user
 * behind a modal until they type something. Both answers set the seen flag, so
 * the prompt never reappears on its own; a name is changed later from Settings.
 *
 * The gate is read once at mount, matching `home-hero/firstRunGuide.ts`'s
 * one-time-guidance shape: a prompt that re-evaluated its gate on every render
 * would flash back into view the moment storage was cleared in another tab.
 */
export function ActorPromptDialog() {
  const t = useT();
  const [open, setOpen] = useState(
    () => getStoredActorName() == null && !hasSeenActorPrompt(),
  );
  const [name, setName] = useState('');

  if (!open) return null;

  const dismiss = () => {
    markActorPromptSeen();
    setOpen(false);
  };

  const save = () => {
    // An empty submit is not an answer: keep the dialog up rather than
    // recording a skip the user did not choose.
    if (!name.trim()) return;
    setStoredActorName(name);
    dismiss();
  };

  const dialog = (
    <Dialog
      role="dialog"
      ariaLabel={t('actorPrompt.title')}
      onClose={dismiss}
      closeOnEscape
      className={styles.panel}
      data-testid="actor-prompt-dialog"
    >
      <h2 className={styles.title}>{t('actorPrompt.title')}</h2>
      <p className={styles.message}>{t('actorPrompt.description')}</p>
      <input
        className={styles.input}
        type="text"
        value={name}
        maxLength={60}
        placeholder={t('actorPrompt.placeholder')}
        aria-label={t('actorPrompt.placeholder')}
        data-testid="actor-prompt-input"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
        }}
      />
      <div className={styles.footer}>
        <Button onClick={dismiss} data-testid="actor-prompt-skip">
          {t('actorPrompt.skip')}
        </Button>
        <Button variant="primary" onClick={save} data-testid="actor-prompt-submit">
          {t('actorPrompt.submit')}
        </Button>
      </div>
    </Dialog>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
