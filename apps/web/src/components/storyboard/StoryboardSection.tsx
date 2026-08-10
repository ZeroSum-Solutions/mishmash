// Storyboard tab — Seedance 2.0 image-first keyframe workflow. List state
// shows existing storyboards as cards; selecting one (or "New storyboard")
// switches to the editor (StoryboardEditor.tsx). Media-provider configuration
// is fetched once here and passed down so every model picker can default to
// a configured provider and mark unconfigured ones.

import { useEffect, useRef, useState } from 'react';
import type { StoryboardSummary } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { createStoryboard, fetchStoryboard, fetchStoryboardList } from '../../providers/registry';
import { goBack, navigate, useRoute } from '../../router';
import { fetchMediaProvidersFromDaemon } from '../../state/config';
import type { ConfiguredProviderMap } from './model-defaults';
import { StoryboardEditor } from './StoryboardEditor';
import styles from './StoryboardSection.module.css';

interface Props {
  active: boolean;
}

export function StoryboardSection({ active }: Props) {
  const t = useT();
  const route = useRoute();
  // The URL is the source of truth for which storyboard is open (OBS-2):
  // opening a card pushes /storyboard/:id, the browser back button pops it,
  // and a reload or shared link lands directly in the editor.
  const routedId =
    route.kind === 'home' && route.view === 'storyboard' ? route.storyboardId ?? null : null;
  const [storyboards, setStoryboards] = useState<StoryboardSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStoryboard, setActiveStoryboard] = useState<import('@open-design/contracts').Storyboard | null>(null);
  const [configured, setConfigured] = useState<ConfiguredProviderMap>({});
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!active || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    setLoading(true);
    void Promise.all([fetchStoryboardList(), fetchMediaProvidersFromDaemon()]).then(([listResult, providers]) => {
      if (listResult.ok) setStoryboards(listResult.value);
      else setError(listResult.message);
      if (providers.status === 'ok') {
        setConfigured(providers.providers ?? {});
      }
      setLoading(false);
    });
  }, [active]);

  // Follow the routed id: a pushed detail entry, browser back/forward, or a
  // cold deep link all resolve through this one effect. A dead id (deleted
  // storyboard, mistyped link) falls back to the list with a clean URL.
  //
  // The one case that must NOT clear: returning to this tab through the nav
  // rail. EntryShell's changeView knows nothing about sub-routes, so a rail
  // switch back arrives as routedId: null — while the editor state is still
  // cached from the keep-mounted tab. That transition (active false → true)
  // re-asserts the open storyboard onto the URL instead. Browser back from
  // the editor keeps `active` true throughout, so it still clears — the URL
  // never bounces back into a redirect trap.
  const wasActiveRef = useRef(active);
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (!active) return;
    if (!routedId) {
      if (!wasActive && activeStoryboard) {
        navigate(
          { kind: 'home', view: 'storyboard', storyboardId: activeStoryboard.id },
          { replace: true },
        );
        return;
      }
      setActiveStoryboard(null);
      return;
    }
    if (activeStoryboard?.id === routedId) return;
    let cancelled = false;
    void fetchStoryboard(routedId).then((result) => {
      if (cancelled) return;
      if (result.ok) setActiveStoryboard(result.value);
      else navigate({ kind: 'home', view: 'storyboard' }, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [active, routedId, activeStoryboard]);

  async function refreshList() {
    const result = await fetchStoryboardList();
    if (result.ok) setStoryboards(result.value);
  }

  async function openStoryboard(id: string) {
    const result = await fetchStoryboard(id);
    if (result.ok) {
      setActiveStoryboard(result.value);
      navigate({ kind: 'home', view: 'storyboard', storyboardId: id });
    }
  }

  async function handleCreate() {
    const result = await createStoryboard('');
    if (result.ok) {
      setActiveStoryboard(result.value);
      navigate({ kind: 'home', view: 'storyboard', storyboardId: result.value.id });
    }
  }

  function handleBack() {
    // Pop the pushed detail entry so browser Back stays coherent; a deep link
    // with no in-app history behind it lands on the list instead.
    goBack({ kind: 'home', view: 'storyboard' });
    void refreshList();
  }

  // Strict id match: while a back/forward navigation is mid-fetch the cached
  // document may still be the previous storyboard — showing it under the new
  // URL would let an edit land on the wrong board.
  if (routedId && activeStoryboard?.id === routedId) {
    return (
      <div className={`entry-section ${styles.root}`}>
        <StoryboardEditor storyboard={activeStoryboard} configured={configured} onBack={handleBack} />
      </div>
    );
  }

  return (
    <div className={`entry-section ${styles.root}`}>
      <header className="entry-section__head">
        <h1 className="entry-section__title">{t('storyboard.title')}</h1>
        <Button type="button" variant="primary" onClick={() => void handleCreate()} data-testid="storyboard-new">
          <Icon name="plus" size={14} />
          {t('storyboard.newStoryboard')}
        </Button>
      </header>

      {loading ? (
        <p className={styles.status}>{t('storyboard.loading')}</p>
      ) : error ? (
        <p className={styles.status}>{error}</p>
      ) : !storyboards || storyboards.length === 0 ? (
        <div className={styles.empty}>
          <p>{t('storyboard.emptyState')}</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {storyboards.map((sb) => (
            <button
              key={sb.id}
              type="button"
              className={styles.card}
              onClick={() => void openStoryboard(sb.id)}
              data-testid="storyboard-card"
            >
              <h3 className={styles.cardTitle}>{sb.title}</h3>
              <p className={styles.cardMeta}>
                {t(sb.shotCount === 1 ? 'storyboard.shotCountOne' : 'storyboard.shotCount', { count: sb.shotCount })} · {new Date(sb.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
