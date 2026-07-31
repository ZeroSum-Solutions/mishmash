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
import { fetchMediaProvidersFromDaemon } from '../../state/config';
import type { ConfiguredProviderMap } from './model-defaults';
import { StoryboardEditor } from './StoryboardEditor';
import styles from './StoryboardSection.module.css';

interface Props {
  active: boolean;
}

export function StoryboardSection({ active }: Props) {
  const t = useT();
  const [storyboards, setStoryboards] = useState<StoryboardSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
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
        const map: ConfiguredProviderMap = {};
        for (const [id, entry] of Object.entries(providers.providers ?? {})) {
          map[id] = Boolean(entry?.apiKeyConfigured);
        }
        setConfigured(map);
      }
      setLoading(false);
    });
  }, [active]);

  async function refreshList() {
    const result = await fetchStoryboardList();
    if (result.ok) setStoryboards(result.value);
  }

  async function openStoryboard(id: string) {
    const result = await fetchStoryboard(id);
    if (result.ok) {
      setActiveStoryboard(result.value);
      setActiveId(id);
    }
  }

  async function handleCreate() {
    const result = await createStoryboard('');
    if (result.ok) {
      setActiveStoryboard(result.value);
      setActiveId(result.value.id);
    }
  }

  function handleBack() {
    setActiveId(null);
    setActiveStoryboard(null);
    void refreshList();
  }

  if (activeId && activeStoryboard) {
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
                {t('storyboard.shotCount', { count: sb.shotCount })} · {new Date(sb.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
