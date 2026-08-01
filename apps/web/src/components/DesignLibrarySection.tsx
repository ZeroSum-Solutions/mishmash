// Design Library tab — read-only browse of the local curated reference-asset
// library (apps/daemon/src/routes/design-library.ts serves it from
// ~/Desktop/Design Assets, or OD_DESIGN_LIBRARY_DIR). Every collection is
// rights-gated via `allowed_use`; the only action ever offered is "Open
// folder" in Finder — no attach/insert/copy affordance exists for any
// category, so a restricted item can never leak into a project this way.
//
// The catalog is fetched once, lazily, the first time this tab becomes
// active — not on app mount.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignLibraryAllowedUse, DesignLibraryItem } from '@open-design/contracts';
import {
  designLibraryThumbUrl,
  fetchDesignLibraryCatalog,
  openDesignLibraryPath,
  type DesignLibraryCatalogResult,
} from '../providers/registry';
import { Icon } from './Icon';
import { useT } from '../i18n';
import styles from './DesignLibrarySection.module.css';

interface Props {
  active: boolean;
}

const ALLOWED_USE_TOOLTIP_KEY = {
  'own-code': 'designLibrary.allowedUse.ownCode',
  'licensed-source-review': 'designLibrary.allowedUse.licensedSourceReview',
  'human-local-only': 'designLibrary.allowedUse.humanLocalOnly',
  'blocked-pending-license': 'designLibrary.allowedUse.blockedPendingLicense',
} as const satisfies Record<DesignLibraryAllowedUse, string>;

function allowedUseLabel(value: DesignLibraryAllowedUse): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function DesignLibrarySection({ active }: Props) {
  const t = useT();
  const [result, setResult] = useState<DesignLibraryCatalogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [domain, setDomain] = useState('');
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!active || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    setLoading(true);
    fetchDesignLibraryCatalog().then((next) => {
      setResult(next);
      setLoading(false);
    });
  }, [active]);

  const catalog = result?.ok ? result.catalog : null;

  const categories = useMemo(
    () => catalog?.groups.map((group) => ({ title: group.title, folder: group.folder })) ?? [],
    [catalog],
  );

  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of catalog?.groups ?? []) {
      for (const item of group.items) {
        for (const d of item.domains) {
          counts.set(d, (counts.get(d) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog]);

  const filteredGroups = useMemo(() => {
    if (!catalog) return [];
    const query = search.trim().toLowerCase();
    return catalog.groups
      .filter((group) => !category || group.folder === category)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (domain && !item.domains.includes(domain)) return false;
          if (query && !item.label.toLowerCase().includes(query)) return false;
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [catalog, search, category, domain]);

  const hasAnyItems = filteredGroups.length > 0;

  return (
    <div className={`entry-section ${styles.root}`}>
      <header className="entry-section__head">
        <h1 className="entry-section__title">{catalog?.library || t('designLibrary.title')}</h1>
        {catalog ? (
          <div className={styles.headerMeta}>
            <span className={styles.collectionsCount}>{catalog.total_collections} collections</span>
            <p className={styles.rightsNote}>{t('designLibrary.rightsNote')}</p>
          </div>
        ) : null}
      </header>

      {loading ? (
        <p className={styles.status}>{t('designLibrary.loading')}</p>
      ) : result && !result.ok ? (
        <div className={styles.empty} data-testid="design-library-empty">
          <p>{result.notFound ? t('designLibrary.emptyNotFound') : result.message}</p>
        </div>
      ) : catalog ? (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <Icon name="search" size={15} className={styles.searchIcon} />
              <input
                className={styles.search}
                type="search"
                placeholder={t('designLibrary.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label={t('designLibrary.allCategories')}
              className={styles.select}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{t('designLibrary.allCategories')}</option>
              {categories.map((c) => (
                <option key={c.folder} value={c.folder}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.chips} role="group" aria-label={t('designLibrary.allDomains')}>
            <button
              type="button"
              className={styles.chip}
              data-active={domain === '' ? 'true' : 'false'}
              onClick={() => setDomain('')}
            >
              {t('designLibrary.allDomains')}
            </button>
            {domainCounts.map(([d, count]) => (
              <button
                key={d}
                type="button"
                className={styles.chip}
                data-active={domain === d ? 'true' : 'false'}
                onClick={() => setDomain((current) => (current === d ? '' : d))}
              >
                {d} <span className={styles.chipCount}>{count}</span>
              </button>
            ))}
          </div>

          {!hasAnyItems ? (
            <div className={styles.empty}>
              <p>{t('designLibrary.emptyFiltered')}</p>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <section key={group.folder} className={styles.group}>
                <header className={styles.groupHead}>
                  <h2 className={styles.groupTitle}>{group.title}</h2>
                  <p className={styles.groupBlurb}>{group.blurb}</p>
                </header>
                <div className={styles.grid}>
                  {group.items.map((item) => (
                    <DesignLibraryCard key={item.id} item={item} t={t} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}

function DesignLibraryCard({
  item,
  t,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
}) {
  const [thumbError, setThumbError] = useState(false);
  const tooltip = t(ALLOWED_USE_TOOLTIP_KEY[item.allowed_use]);

  return (
    <article className={styles.card} data-testid="design-library-card" data-allowed-use={item.allowed_use}>
      <div className={styles.thumb}>
        {item.thumb && !thumbError ? (
          <img
            className={styles.thumbImg}
            src={designLibraryThumbUrl(item.thumb)}
            alt=""
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <Icon name="image" size={28} className={styles.thumbGlyph} />
        )}
        <span className={styles.badge} data-allowed-use={item.allowed_use} title={tooltip}>
          {allowedUseLabel(item.allowed_use)}
        </span>
      </div>
      <div className={styles.meta}>
        <h3 className={styles.label}>{item.label}</h3>
        <p className={styles.detail}>
          {item.kind} · {item.files} {t('designLibrary.filesUnit')} · {item.size}
        </p>
        {item.domains.length > 0 ? (
          <div className={styles.domains}>
            {item.domains.map((d) => (
              <span key={d} className={styles.domainTag}>
                {d}
              </span>
            ))}
          </div>
        ) : null}
        {item.duplicate_of ? (
          <p className={styles.duplicateNote}>
            {t('designLibrary.duplicateOfPrefix')} {item.duplicate_of}
          </p>
        ) : null}
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.openFolderBtn} onClick={() => openDesignLibraryPath(item.rel)}>
          <Icon name="folder" size={14} />
          {t('designLibrary.openFolder')}
        </button>
      </div>
    </article>
  );
}
