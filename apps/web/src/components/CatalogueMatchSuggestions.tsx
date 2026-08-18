// Web half of the brief -> library matcher (see
// packages/contracts/src/api/catalogue-match.ts for why this exists: 561
// design templates + 164 skills carry curated triggers that nothing ever
// compared a user's brief against). Calls the same POST /api/catalogue/match
// endpoint the `od catalogue match` CLI calls (apps/daemon/src/cli.ts,
// apps/daemon/src/routes/catalogue-match.ts) — per AGENTS.md "Capability
// exposure", one endpoint, two callers.
//
// Suggest, never hijack: this component only ever shows a shortlist and
// hands `onAccept` an id on click. It never applies anything itself — the
// caller (HomeView) decides what "accept" means, and the caller is the one
// that already gates this component off once the user has an explicit
// skill/template active.

import { useEffect, useState } from 'react';
import { Button } from '@open-design/components';
import type { CatalogueMatch, CatalogueMatchResponse } from '@open-design/contracts';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './CatalogueMatchSuggestions.module.css';

// Debounced so a fast typist doesn't fire one request per keystroke.
const DEBOUNCE_MS = 500;
// Below this length a brief carries too little signal for any match to be
// worth a round trip — the ranking engine would return empty anyway (see
// MIN_SCORE_TO_SURFACE in catalogue-match.ts), so skip the request entirely.
const MIN_PROMPT_LENGTH = 12;

interface Props {
  /** The composer's current draft text. */
  prompt: string;
  /** Hides the row entirely — e.g. once the user already has an explicit skill/template active. */
  disabled?: boolean;
  onAccept: (match: CatalogueMatch) => void;
}

export function CatalogueMatchSuggestions({ prompt, disabled = false, onAccept }: Props) {
  const t = useT();
  const [matches, setMatches] = useState<CatalogueMatch[]>([]);
  // Keyed by the exact prompt text it was dismissed for, so editing the
  // draft brings the row back rather than suppressing it permanently.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) {
      setMatches([]);
      return;
    }
    const trimmed = prompt.trim();
    if (trimmed.length < MIN_PROMPT_LENGTH) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const resp = await fetch('/api/catalogue/match', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: trimmed }),
          });
          if (!resp.ok || cancelled) return;
          const data = (await resp.json()) as CatalogueMatchResponse;
          if (!cancelled) setMatches(Array.isArray(data.matches) ? data.matches : []);
        } catch {
          if (!cancelled) setMatches([]);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prompt, disabled]);

  if (disabled || matches.length === 0 || dismissedFor === prompt) return null;

  return (
    <div className={styles.row} data-testid="catalogue-match-suggestions">
      <span className={styles.icon} aria-hidden="true">
        <Icon name="sparkles" size={13} strokeWidth={1.7} />
      </span>
      <span className={styles.label}>{t('home.catalogueMatch.heading')}</span>
      <div className={styles.chips}>
        {matches.map((match) => (
          <Button
            key={match.id}
            type="button"
            variant="subtle"
            className={styles.chip}
            title={match.description}
            aria-label={t('home.catalogueMatch.applyAria', { name: match.name })}
            onClick={() => onAccept(match)}
            data-testid="catalogue-match-chip"
          >
            {match.name}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles.dismiss}
        aria-label={t('home.catalogueMatch.dismiss')}
        onClick={() => setDismissedFor(prompt)}
      >
        <Icon name="close" size={11} strokeWidth={1.8} />
      </Button>
    </div>
  );
}
