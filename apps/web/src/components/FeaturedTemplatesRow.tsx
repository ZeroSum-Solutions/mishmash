// Home "Workflows and Assets" featured row — a sibling strip rendered
// above PluginsHomeSection (RecentProjectsStrip pattern; see
// docs/plans/2026-08-01-ui8-kit-starters-and-home-restructure.md §Stream B).
// Two groups in one row:
//   1. Four UI8 kit template cards. Thumbs + rights metadata come from the
//      design-library catalog; clicking a card copies the kit into a new
//      project via `startDesignLibraryProject` (providers/registry) and
//      opens it.
//   2. Four tool cards that seed the Home composer with a plugin + prompt
//      brief, the same bind mechanism the HomeHero chip rail uses
//      (`usePlugin`/`requestActivePlugin` in HomeView) — dispatched here
//      through the `onToolAction` callback HomeView already owns.
//
// Degrades gracefully: when the design-library catalog is absent (404) or
// none of the four known rels are present in it, the template group hides
// entirely and the tools row renders alone.

import { useEffect, useState } from 'react';
import type { DesignLibraryAllowedUse, DesignLibraryItem } from '@open-design/contracts';
import { designLibraryThumbUrl, fetchDesignLibraryCatalog, startDesignLibraryProject } from '../providers/registry';
import { Icon, type IconName } from './Icon';
import { Toast } from './Toast';
import { useT } from '../i18n';
import styles from './FeaturedTemplatesRow.module.css';

// Only these allowed_use tiers may render as a template card (mirrors
// COPYABLE_ALLOWED_USE in DesignLibrarySection.tsx / the daemon's
// design-library route). A featured rel reclassified to a restricted tier
// must drop out of the row rather than keep rendering with the "UI8
// licensed" badge and a copy affordance — that would violate the zero-copy-
// affordance rights rule for restricted assets.
const COPYABLE_ALLOWED_USE = new Set<DesignLibraryAllowedUse>(['own-code', 'licensed-source-review']);

export type FeaturedToolId = 'hero-creation' | 'web-shells' | 'scroll-animations' | 'scroll-film';

interface FeaturedTemplateSpec {
  id: 'dwell' | 'morrow' | 'azurio' | 'core2';
  rel: string;
  labelKey: 'home.featured.template.dwell.label' | 'home.featured.template.morrow.label' | 'home.featured.template.azurio.label' | 'home.featured.template.core2.label';
  descriptorKey:
    | 'home.featured.template.dwell.descriptor'
    | 'home.featured.template.morrow.descriptor'
    | 'home.featured.template.azurio.descriptor'
    | 'home.featured.template.core2.descriptor';
}

const FEATURED_TEMPLATES: readonly FeaturedTemplateSpec[] = [
  {
    id: 'dwell',
    rel: '01 UI8 Kits/dwell',
    labelKey: 'home.featured.template.dwell.label',
    descriptorKey: 'home.featured.template.dwell.descriptor',
  },
  {
    id: 'morrow',
    rel: '01 UI8 Kits/morrow-architecture-website-template',
    labelKey: 'home.featured.template.morrow.label',
    descriptorKey: 'home.featured.template.morrow.descriptor',
  },
  {
    id: 'azurio',
    rel: '01 UI8 Kits/azurio-digital-agency-and-personal-portfolio-html-template',
    labelKey: 'home.featured.template.azurio.label',
    descriptorKey: 'home.featured.template.azurio.descriptor',
  },
  {
    id: 'core2',
    rel: '01 UI8 Kits/core-2-dashboard-builder-react',
    labelKey: 'home.featured.template.core2.label',
    descriptorKey: 'home.featured.template.core2.descriptor',
  },
];

interface FeaturedToolSpec {
  id: FeaturedToolId;
  icon: IconName;
  labelKey: 'home.featured.tool.heroCreation.label' | 'home.featured.tool.webShells.label' | 'home.featured.tool.scrollAnimations.label' | 'home.featured.tool.scrollFilm.label';
  descriptorKey:
    | 'home.featured.tool.heroCreation.descriptor'
    | 'home.featured.tool.webShells.descriptor'
    | 'home.featured.tool.scrollAnimations.descriptor'
    | 'home.featured.tool.scrollFilm.descriptor';
}

const FEATURED_TOOLS: readonly FeaturedToolSpec[] = [
  {
    id: 'hero-creation',
    icon: 'sparkles',
    labelKey: 'home.featured.tool.heroCreation.label',
    descriptorKey: 'home.featured.tool.heroCreation.descriptor',
  },
  {
    id: 'web-shells',
    icon: 'layout',
    labelKey: 'home.featured.tool.webShells.label',
    descriptorKey: 'home.featured.tool.webShells.descriptor',
  },
  {
    id: 'scroll-animations',
    icon: 'play',
    labelKey: 'home.featured.tool.scrollAnimations.label',
    descriptorKey: 'home.featured.tool.scrollAnimations.descriptor',
  },
  {
    id: 'scroll-film',
    icon: 'film',
    labelKey: 'home.featured.tool.scrollFilm.label',
    descriptorKey: 'home.featured.tool.scrollFilm.descriptor',
  },
];

interface Props {
  /** Opens the newly-created project — same callback HomeView already
   *  receives and uses for every other project-creation entry point. */
  onOpenProject: (projectId: string, fileName?: string) => void;
  /** Dispatches a tool card into HomeView's existing plugin-bind
   *  machinery (usePlugin/requestActivePlugin) — the HomeHero chip rail
   *  itself is never touched. */
  onToolAction: (toolId: FeaturedToolId) => void;
}

export function FeaturedTemplatesRow({ onOpenProject, onToolAction }: Props) {
  const t = useT();
  const [items, setItems] = useState<ReadonlyMap<string, DesignLibraryItem>>(new Map());
  const [catalogAvailable, setCatalogAvailable] = useState(false);
  const [pendingRel, setPendingRel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDesignLibraryCatalog().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setCatalogAvailable(false);
        setItems(new Map());
        return;
      }
      const byRel = new Map<string, DesignLibraryItem>();
      for (const group of result.catalog.groups) {
        for (const item of group.items) {
          byRel.set(item.rel, item);
        }
      }
      setCatalogAvailable(true);
      setItems(byRel);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const templates = FEATURED_TEMPLATES.map((spec) => ({ spec, item: items.get(spec.rel) ?? null })).filter(
    (entry): entry is { spec: FeaturedTemplateSpec; item: DesignLibraryItem } =>
      entry.item !== null && COPYABLE_ALLOWED_USE.has(entry.item.allowed_use),
  );
  const showTemplates = catalogAvailable && templates.length > 0;

  async function handleTemplateClick(spec: FeaturedTemplateSpec) {
    if (pendingRel) return;
    setError(null);
    setPendingRel(spec.rel);
    try {
      const result = await startDesignLibraryProject(spec.rel);
      if (!result.ok) {
        setError(t('home.featured.startError'));
        return;
      }
      onOpenProject(result.response.projectId);
    } catch {
      setError(t('home.featured.startError'));
    } finally {
      setPendingRel(null);
    }
  }

  return (
    <section className={styles.root} data-testid="featured-templates-row">
      {showTemplates ? (
        <div className={styles.group}>
          <h2 className={styles.groupTitle}>{t('home.featured.title')}</h2>
          <div className={styles.grid} role="list">
            {templates.map(({ spec, item }) => {
              const busy = pendingRel === spec.rel;
              return (
                <button
                  key={spec.id}
                  type="button"
                  role="listitem"
                  className={styles.templateCard}
                  data-testid="featured-template-card"
                  data-rel={spec.rel}
                  disabled={pendingRel !== null}
                  aria-busy={busy}
                  onClick={() => void handleTemplateClick(spec)}
                >
                  <div className={styles.thumb}>
                    {item.thumb ? (
                      <img
                        className={styles.thumbImg}
                        src={designLibraryThumbUrl(item.thumb)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <Icon name="layout" size={20} className={styles.thumbGlyph} />
                    )}
                    <span className={styles.badge}>{t('home.featured.badge')}</span>
                  </div>
                  <div className={styles.meta}>
                    <p className={styles.label}>{t(spec.labelKey)}</p>
                    <p className={styles.descriptor}>
                      {busy ? t('home.featured.starting') : t(spec.descriptorKey)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={styles.group}>
        <div className={styles.grid} role="list">
          {FEATURED_TOOLS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              role="listitem"
              className={styles.toolCard}
              data-testid="featured-tool-card"
              data-tool-id={spec.id}
              onClick={() => onToolAction(spec.id)}
            >
              <Icon name={spec.icon} size={18} className={styles.toolIcon} />
              <div className={styles.meta}>
                <p className={styles.label}>{t(spec.labelKey)}</p>
                <p className={styles.descriptor}>{t(spec.descriptorKey)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Toast message={error} tone="error" role="alert" onDismiss={() => setError(null)} />
      ) : null}
    </section>
  );
}
