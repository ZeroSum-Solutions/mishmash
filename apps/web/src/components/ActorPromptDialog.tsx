import { useEffect, useState } from 'react';

import { useT } from '../i18n';
import {
  getStoredActorName,
  hasSeenActorPrompt,
  markActorPromptSeen,
} from '../runtime/actor-identity';
import { Toast } from './Toast';

/**
 * One-time "who are you" prompt (F-03 / D-2).
 *
 * INVARIANT: this asks at most once per browser profile and never blocks
 * anything. Attribution is optional under D-2, so letting the prompt go by is
 * a real answer — it leaves the browser unattributed rather than parking the
 * user behind an unanswered question. The name is set, and changed later, from
 * the Settings "Display name" row (`settings-actor-name`), which this prompt's
 * one action opens.
 *
 * It is raised through the app's own transient toast, and that took four
 * attempts to get right. The history is the specification here, because each
 * earlier shape broke the page in a way the next one had to avoid:
 *
 * 1. NOT the shared `Dialog` (`packages/components/src/dialog.tsx`), which
 *    always wraps its panel in a full-viewport `.modal-backdrop` and hardcodes
 *    `aria-modal="true"` with no opt-out — every unanswered profile had the
 *    whole page sealed behind it (14 failures in
 *    `e2e/ui/app-design-files.test.ts`).
 *
 * 2. NOT `role="dialog"`. A nudge that takes no focus and traps nothing is not
 *    a dialog, and counting it as one made `page.getByRole('dialog')` — which
 *    is strict-mode — resolve to 2 elements as soon as Settings opened
 *    (`e2e/ui/entry-chrome-flows.test.ts:129,:567,:686,:879`).
 *
 * 3. NOT a fixed corner card. Wherever it was pinned it landed on something
 *    clickable: a deck's Next slide button, the HTML preview toolbar, a plugin
 *    details modal's Use button, the create rail's own "More" trigger.
 *
 * 4. NOT an in-flow block in the Home column either. Taking a row there added
 *    ~250px of height ABOVE the create rail (measured: the "More" shortcuts
 *    trigger sat at document y=829 with the block mounted, y=580 without), and
 *    `HomeHero`'s `ShortcutsMenu` portals its dropdown to `<body>` with
 *    `position: fixed; top = trigger.getBoundingClientRect().bottom + 6`. The
 *    displaced anchor pushed the panel's lower items below the fold — and a
 *    fixed element cannot be scrolled into view, so those items became
 *    permanently unclickable (`e2e/ui/home-hero-rail.test.ts:1330,:1594,:1844`
 *    timed out after 110 click retries).
 *
 * What survives all four is the app's existing `Toast`: fixed to the bottom of
 * the viewport so it displaces nothing, no backdrop, no focus trap, not a
 * dialog, and — unlike every previous shape — temporary, so whatever it does
 * overlap it stops overlapping a few seconds later.
 *
 * The once-per-profile gate is therefore spent when the toast is SHOWN, not
 * when it is answered. A toast that fades on its own has no "declined" event;
 * if the gate waited for one, anyone who simply let it pass would be asked
 * again on every visit to Home, for ever. Showing it is the question.
 */
export function ActorPromptDialog({
  homeVisible,
  onOpenActorNameSettings,
}: {
  /** Whether the Home view is the surface currently in front of the user. */
  homeVisible: boolean;
  /** Opens the Settings row that owns the name (Appearance → Display name). */
  onOpenActorNameSettings: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    // Being held back because Home is behind another tab is not an answer: the
    // gate stays unspent until the toast is actually put in front of someone.
    if (!homeVisible || asked) return;
    if (getStoredActorName() != null || hasSeenActorPrompt()) return;
    markActorPromptSeen();
    setAsked(true);
    setOpen(true);
  }, [homeVisible, asked]);

  if (!open) return null;

  return (
    <Toast
      testId="actor-prompt-dialog"
      message={t('actorPrompt.title')}
      details={t('actorPrompt.description')}
      actionLabel={t('actorPrompt.action')}
      onAction={() => {
        setOpen(false);
        onOpenActorNameSettings();
      }}
      onDismiss={() => setOpen(false)}
    />
  );
}
