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
 * How "never blocks anything" is honoured, structurally.
 *
 * 1. Not a `Dialog`, and not a dialog. The shared `Dialog`
 *    (`packages/components/src/dialog.tsx`) always wraps its panel in a
 *    full-viewport `.modal-backdrop` layer and hardcodes `aria-modal="true"`,
 *    with no opt-out — so rendering through it sealed the whole page behind an
 *    unanswered prompt. This renders the same content in the idiom of the
 *    repo's other non-blocking one-time surfaces (`BrandReadyPrompt`,
 *    `MemoryToast`): a corner card with no backdrop, no `aria-modal` and no
 *    focus trap. The landmark is `<aside>` (implicit role `complementary`),
 *    NOT `role="dialog"`: a nudge that takes no focus and traps nothing is not
 *    a dialog, and counting it as one broke every test that asks the page for
 *    its dialog — `page.getByRole('dialog')` is strict-mode and resolved to 2
 *    elements as soon as Settings opened (wave-8 integration Playwright,
 *    `e2e/ui/entry-chrome-flows.test.ts:129,:567,:686,:879`).
 *
 * 2. Scoped to Home. "Never blocks anything" is a promise about pointer events
 *    too, and a fixed corner card cannot keep it on every surface: on project
 *    and sub-view surfaces it sat over a deck's Next slide button, the HTML
 *    preview toolbar and a plugin details modal's Use button (11 more failures
 *    in the same run). So the caller decides where it may appear, and passes
 *    `homeVisible` for the one surface it belongs on — the Home view, no
 *    project open and no sub-view in front of it — the same gate its neighbour
 *    `AmrArtifactUpgradeGate` already takes in `App.tsx`. Being held back by
 *    that gate is not an answer: the once-per-profile flag stays unspent, so
 *    the user is still asked the first time they are actually home.
 *
 * Escape dismisses it while focus is inside the card; a global Escape listener
 * would steal the key from whatever surface the user is actually working in.
 *
 * The storage gate is read once at mount, matching
 * `home-hero/firstRunGuide.ts`'s one-time-guidance shape: a prompt that
 * re-evaluated it on every render would flash back into view the moment
 * storage was cleared in another tab.
 */
export function ActorPromptDialog({
  homeVisible,
}: {
  /** Whether the Home view is the surface currently in front of the user. */
  homeVisible: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(
    () => getStoredActorName() == null && !hasSeenActorPrompt(),
  );
  const [name, setName] = useState('');

  if (!open || !homeVisible) return null;

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
    <aside
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
    </aside>
  );

  if (typeof document === 'undefined') return card;
  return createPortal(card, document.body);
}
