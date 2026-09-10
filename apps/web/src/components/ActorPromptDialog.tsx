import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@open-design/components';

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
 * How "never blocks anything" is honoured, structurally: the prompt is a
 * non-modal corner card, not a `Dialog`. The shared `Dialog`
 * (`packages/components/src/dialog.tsx`) always wraps its panel in a
 * full-viewport `.modal-backdrop` layer and hardcodes `aria-modal="true"`, with
 * no opt-out — so rendering through it sealed the whole page behind an
 * unanswered prompt (caught by the wave-8 integration Playwright gate: every
 * click in `e2e/ui/app-design-files.test.ts` hit the backdrop instead of the
 * page). This renders the same content in the idiom of the repo's other
 * non-blocking one-time surfaces (`BrandReadyPrompt`, `MemoryToast`): a fixed
 * bottom-corner card with no backdrop, no `aria-modal` and no focus trap, so
 * pointer events reach everything except the card's own box. Escape dismisses
 * it while focus is inside the card; a global Escape listener would steal the
 * key from whatever surface the user is actually working in.
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
    // An empty submit is not an answer: keep the prompt up rather than
    // recording a skip the user did not choose.
    if (!name.trim()) return;
    setStoredActorName(name);
    dismiss();
  };

  const card = (
    <section
      role="dialog"
      aria-label={t('actorPrompt.title')}
      className={styles.card}
      data-testid="actor-prompt-dialog"
      onKeyDown={(event) => {
        if (event.key === 'Escape') dismiss();
      }}
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
    </section>
  );

  if (typeof document === 'undefined') return card;
  return createPortal(card, document.body);
}
