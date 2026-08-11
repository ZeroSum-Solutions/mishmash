// Templates gallery (/templates → EntryShell view 'templates').
//
// Before this view existed, `/api/design-templates` was a registry with no
// full-catalogue surface: the only place a design template could appear was
// the home "Start with a template" rail, which filters to `mode` prototype |
// deck. Every `mode: template` entry — including a user root populated from
// outside the repo — was therefore invisible in the product.
//
// The gallery renders one card per template with a real rendered thumbnail
// (the same `/api/skills/:id/example` document the daemon already serves),
// and opens a detail overlay with the full preview plus the two escape
// hatches: open the example standalone in a new browser tab, or start a
// project from the template.
//
// Preview iframes are `sandbox="allow-scripts"` WITHOUT `allow-same-origin`,
// matching DeckThumbnailRail / DesignFilesPanel. Templates are third-party
// content served from the daemon's own origin, so an unsandboxed frame could
// reach `/api/*` with the user's session; an opaque origin cannot.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GuidedCreateBrief, SkillSummary } from '@open-design/contracts';
import { Icon } from './Icon';
import { MediaFallback } from './MediaFallback';
import { GuidedCreateDialog } from './GuidedCreateDialog';
import { useI18n, useT } from '../i18n';
import { localizeSkillDescription, localizeSkillName } from '../i18n/content';
import { openSandboxedUrlInNewTab } from '../runtime/exports';

type SourceFilter = 'all' | 'user' | 'built-in';

interface Props {
  templates: SkillSummary[];
  /** Rendered only when the view is on screen — keeps offscreen iframes unmounted. */
  active: boolean;
  /**
   * Resolves false (or rejects) when creation failed, so the overlay can say
   * so. `brief` carries the guided create flow's answers (PRD C8) when the
   * user filled any in; omitted entirely for a skip-all submit.
   */
  onUseTemplate: (
    template: SkillSummary,
    brief?: GuidedCreateBrief,
  ) => Promise<boolean | void> | boolean | void;
}

function exampleUrl(id: string): string {
  return `/api/skills/${encodeURIComponent(id)}/example`;
}

// Ingested entries are named `<vendor>-<project>`; the vendor prefix is the
// only provenance the registry summary carries (od.source.* is not part of
// SkillSummary). Built-in entries have no prefix and get no badge.
// Only `previewType: 'html'` entries have a rendered example; the handful of
// markdown ones 404 on /example, so they get a placeholder instead of a frame
// that would sit blank and log a console error per card.
function hasHtmlPreview(t: SkillSummary): boolean {
  return t.previewType === 'html';
}

function posterUrl(id: string): string {
  return `/api/skills/${encodeURIComponent(id)}/assets/poster.jpg`;
}

// Card thumbnail: a poster image when the entry ships one, otherwise a live
// frame.
//
// Rendering the example in an iframe per card does not scale. Each example is
// a whole site — its own CSS, fonts, and images — and the asset route rescans
// every registry root per request, so a screenful of frames means hundreds of
// requests and the gallery paints blank while the daemon catches up. Every
// ingested entry ships an `assets/poster.jpg` (one request, one decode), so
// prefer it and keep the frame as the fallback for entries without one.
//
// Both paths are still gated on an IntersectionObserver: `loading="lazy"` did
// not stop the browser from starting all 300+ requests at once.
function TemplateThumb({ id, title, previewLabel }: { id: string; title: string; previewLabel: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [posterLoaded, setPosterLoaded] = useState(false);

  // Keep observing rather than disconnecting on first sight. A scripted frame
  // that stays mounted after scrolling away is a live document holding timers,
  // animations, and memory — over a long scroll through 300 cards that
  // accumulates without bound. Posters are cheap to keep, but the frame path
  // has to be able to let go.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      className={`templates-card__thumb${posterFailed ? '' : ' templates-card__thumb--poster'}`}
      ref={ref}
    >
      {!visible ? null : posterFailed ? (
        <iframe src={exampleUrl(id)} title={title} sandbox="allow-scripts" tabIndex={-1} aria-hidden="true" />
      ) : (
        // Hidden until decoded: a failed poster request never paints a
        // broken-image glyph — onLoad reveals it, onError swaps to the live
        // iframe fallback above before it ever becomes visible.
        <img
          className={posterLoaded ? 'is-loaded' : undefined}
          src={posterUrl(id)}
          alt=""
          loading="lazy"
          onLoad={() => setPosterLoaded(true)}
          onError={() => setPosterFailed(true)}
        />
      )}
      {/* Transparent overlay: keeps pointer/scroll events inside the frame
          from reaching the template so the card owns every click. */}
      <span className="templates-card__thumb-veil" aria-hidden="true" />
      {/* Hover/focus affordance — same dark-scrim + glyph + label pattern as
          the Design Library card's preview overlay, so the "click opens
          detail" cue reads identically across both galleries. */}
      <span className="templates-card__thumb-hint" aria-hidden="true">
        <Icon name="eye" size={16} />
        <span>{previewLabel}</span>
      </span>
    </span>
  );
}

function vendorOf(t: SkillSummary): string | null {
  if (t.source !== 'user') return null;
  const dash = t.id.indexOf('-');
  return dash > 0 ? t.id.slice(0, dash) : null;
}

// Data-only mirror of CATEGORY_LABELS and the canonical `od.category` enum
// in scripts/design-taxonomy.mjs. apps/web cannot import scripts/ — it sits
// outside the pnpm workspace (see AGENTS.md § Workspace directories) — so
// this stays a hand-kept mirror; update both together when the taxonomy
// changes. NOT used for rendering — every string the UI shows must come
// from the `Dict` (see AGENTS.md § i18n keys), so `CATEGORY_LABEL_KEYS`
// below is the map actually consumed by `categoryLabel`.
const CATEGORY_LABELS: Record<string, string> = {
  deck: 'Deck',
  'landing-page': 'Landing Page',
  dashboard: 'Dashboard',
  'mobile-app': 'Mobile App',
  'web-app': 'Web App',
  docs: 'Docs',
  'document-guide': 'Document Guide',
  email: 'Email',
  prototype: 'Prototype',
  audio: 'Audio',
  'video-motion': 'Video / Motion',
  webgl: 'WebGL',
  icons: 'Icons',
  effect: 'Effect',
  component: 'Component',
  'ui-kit': 'UI Kit',
  'design-system': 'Design System',
  capture: 'Capture',
  inspiration: 'Inspiration',
  tool: 'Tool',
};

type TFn = ReturnType<typeof useT>;
type DictKey = Parameters<TFn>[0];

// od.category slug -> i18n key, one entry per CATEGORY_LABELS key. PRD C12:
// the tab must lead with websites, so `landingPage`/`webApp`/`dashboard`
// carry product-facing copy ("Websites & Landing Pages", etc, see en.ts)
// instead of the raw CATEGORY_LABELS gloss; every other key mirrors
// CATEGORY_LABELS as-is.
const CATEGORY_LABEL_KEYS: Record<string, DictKey> = {
  deck: 'templates.category.deck',
  'landing-page': 'templates.category.landingPage',
  dashboard: 'templates.category.dashboard',
  'mobile-app': 'templates.category.mobileApp',
  'web-app': 'templates.category.webApp',
  docs: 'templates.category.docs',
  'document-guide': 'templates.category.documentGuide',
  email: 'templates.category.email',
  prototype: 'templates.category.prototype',
  audio: 'templates.category.audio',
  'video-motion': 'templates.category.videoMotion',
  webgl: 'templates.category.webgl',
  icons: 'templates.category.icons',
  effect: 'templates.category.effect',
  component: 'templates.category.component',
  'ui-kit': 'templates.category.uiKit',
  'design-system': 'templates.category.designSystem',
  capture: 'templates.category.capture',
  inspiration: 'templates.category.inspiration',
  tool: 'templates.category.tool',
};

// Fixed section/chip display order: websites lead, web-app and dashboard
// are split out as their own categories right after, then the rest in a
// sensible fixed order (decks, mobile, docs/document-guides, email,
// components, prototypes, media, tools last). A category present in the
// data but absent from this list (shouldn't happen — every value in
// design-taxonomy.mjs's CATEGORIES is covered) sorts after all of these.
const SECTION_ORDER: string[] = [
  'landing-page',
  'web-app',
  'dashboard',
  'deck',
  'mobile-app',
  'docs',
  'document-guide',
  'email',
  'component',
  'ui-kit',
  'design-system',
  'prototype',
  'audio',
  'video-motion',
  'webgl',
  'effect',
  'icons',
  'capture',
  'inspiration',
  'tool',
];

const UNCATEGORIZED = 'uncategorized';

function templateCategory(tpl: SkillSummary): string {
  return tpl.category || UNCATEGORIZED;
}

// Every taxonomy category renders through a Dict key. A category value that
// isn't in the taxonomy (shouldn't happen — see SECTION_ORDER's comment)
// falls back to the raw slug: at that point it's unrecognized external data
// from a SKILL.md, not authored UI copy, so there's no fixed key for it —
// same treatment the card gives `tpl.mode`.
function categoryLabel(category: string, t: TFn): string {
  if (category === UNCATEGORIZED) return t('templates.category.uncategorized');
  const key = CATEGORY_LABEL_KEYS[category];
  return key ? t(key) : category;
}

function categoryRank(category: string): number {
  const idx = SECTION_ORDER.indexOf(category);
  return idx === -1 ? SECTION_ORDER.length : idx;
}

// Tie-break on the raw slug rather than the (localized, t-dependent) label:
// ties only happen between categories absent from SECTION_ORDER, and the
// sort itself doesn't need translation to stay deterministic.
function byCategoryOrder(a: string, b: string): number {
  const rankDiff = categoryRank(a) - categoryRank(b);
  if (rankDiff !== 0) return rankDiff;
  return a.localeCompare(b);
}

// A single card, extracted so it renders identically inside every category
// section without duplicating the markup per section.
function TemplateCard({
  tpl,
  locale,
  t,
  onOpen,
}: {
  tpl: SkillSummary;
  locale: ReturnType<typeof useI18n>['locale'];
  t: ReturnType<typeof useT>;
  onOpen: (id: string, el: HTMLElement) => void;
}) {
  const name = localizeSkillName(locale, tpl);
  const vendor = vendorOf(tpl);
  const description = localizeSkillDescription(locale, tpl);
  return (
    <button
      type="button"
      className="templates-card"
      // The card wraps an aria-hidden preview frame, which leaves the
      // computed name unreliable; state it outright.
      aria-label={name}
      onClick={(e) => onOpen(tpl.id, e.currentTarget)}
      data-testid="templates-card"
      data-template-id={tpl.id}
    >
      {hasHtmlPreview(tpl) ? (
        <TemplateThumb
          id={tpl.id}
          title={t('templates.previewAria', { name })}
          previewLabel={t('common.preview')}
        />
      ) : (
        <span className="templates-card__thumb templates-card__thumb--none">
          <MediaFallback label={t('templates.noPreview')} />
        </span>
      )}
      <span className="templates-card__body">
        <span className="templates-card__title">{name}</span>
        <span className="templates-card__meta">
          <span className="templates-card__mode">{tpl.mode}</span>
          {vendor ? <span>{vendor}</span> : null}
        </span>
        {description ? (
          <span className="templates-card__description" data-testid="templates-card-description">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function TemplatesSection({ templates, active, onUseTemplate }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  // Guided create flow (PRD C8) — shown in front of "Start", not on open;
  // Skip-all reproduces today's single-click create exactly.
  const [guidedOpen, setGuidedOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...templates].sort((a, b) =>
        localizeSkillName(locale, a).localeCompare(localizeSkillName(locale, b)),
      ),
    [templates, locale],
  );

  // Search + source filter only — the category filter narrows this further
  // below, but chip counts are computed off this stage so every non-empty
  // category stays selectable regardless of which one is currently active.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((tpl) => {
      if (sourceFilter === 'user' && tpl.source !== 'user') return false;
      if (sourceFilter === 'built-in' && tpl.source === 'user') return false;
      if (!q) return true;
      return (
        tpl.id.toLowerCase().includes(q)
        || localizeSkillName(locale, tpl).toLowerCase().includes(q)
        || localizeSkillDescription(locale, tpl).toLowerCase().includes(q)
        // `triggers` is typed string[], but it comes from SKILL.md
        // frontmatter and the daemon's reader can hand back a non-string for
        // a value like `- "1:1 notes"` (it splits on the colon before it
        // handles quotes). Registry data is external input here — check the
        // type rather than trusting the contract.
        || tpl.triggers.some(
          (trigger) => typeof trigger === 'string' && trigger.toLowerCase().includes(q),
        )
      );
    });
  }, [sorted, query, sourceFilter, locale]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tpl of searched) {
      const category = templateCategory(tpl);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [searched]);

  // All + each non-empty category, in the fixed taxonomy order.
  const categoryChips = useMemo(
    () => [...categoryCounts.keys()].sort(byCategoryOrder),
    [categoryCounts],
  );

  // The picked category can drop out from under the user — a data refresh,
  // or narrowing the search/source filter until it has zero matches.
  // Derived (not a separate effect+state correction) so there is no frame
  // where a stuck chip sits `data-active` over an empty grid: the fallback
  // to "all" is already in effect on the very render that would otherwise
  // be empty.
  const activeCategoryFilter =
    categoryFilter !== 'all' && !categoryCounts.has(categoryFilter) ? 'all' : categoryFilter;

  const shown = useMemo(() => {
    if (activeCategoryFilter === 'all') return searched;
    return searched.filter((tpl) => templateCategory(tpl) === activeCategoryFilter);
  }, [searched, activeCategoryFilter]);

  // `shown` grouped into sections in the fixed taxonomy order. A category
  // with zero templates in the current filter set never gets an entry, so
  // it renders no section and no chip.
  const sections = useMemo(() => {
    const groups = new Map<string, SkillSummary[]>();
    for (const tpl of shown) {
      const category = templateCategory(tpl);
      const list = groups.get(category);
      if (list) list.push(tpl);
      else groups.set(category, [tpl]);
    }
    return [...groups.keys()]
      .sort(byCategoryOrder)
      .map((category) => ({ category, templates: groups.get(category) ?? [] }));
  }, [shown]);

  const open = useMemo(
    () => (openId ? (templates.find((tpl) => tpl.id === openId) ?? null) : null),
    [openId, templates],
  );

  // The view stays mounted while another destination is on screen, so an
  // overlay left open would still be open on return. Drop it on deactivate.
  useEffect(() => {
    if (!active) setOpenId(null);
  }, [active]);

  // A retry state belongs to one entry, not to the overlay in general.
  useEffect(() => {
    setCreateFailed(false);
    setCreating(false);
    setGuidedOpen(false);
  }, [openId]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // The card that opened the overlay, so focus can go back where it started.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Escape closes; Tab is trapped inside the panel. `aria-modal` promises the
  // rest of the page is inert, and nothing else here delivers that.
  //
  // Escape pressed while focus sits inside the preview iframe never reaches
  // us — the frame is sandboxed and cross-origin, so its key events are not
  // ours to see. The visible close button and the backdrop click are the
  // reachable exits from there.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!creating) setOpenId(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, creating]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const previous = returnFocusRef.current;
    return () => {
      // Only pull focus back if it is still inside the closing overlay —
      // otherwise we would yank it away from wherever the user moved on to.
      if (previous?.isConnected && panelRef.current?.contains(document.activeElement)) {
        previous.focus();
      }
    };
  }, [open]);

  if (!active) return null;

  return (
    <div className="templates-view" data-testid="templates-view">
      <header className="templates-view__header">
        <div>
          <h1>{t('templates.title')}</h1>
          <p className="templates-view__subtitle">{t('templates.subtitle')}</p>
        </div>
        <span className="templates-view__count">
          {t('templates.count', { shown: shown.length, total: templates.length })}
        </span>
      </header>

      <div className="templates-view__controls">
        <label className="templates-view__search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder={t('templates.search')}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="templates-search"
          />
        </label>
        <div className="templates-view__filters" role="group">
          {(['all', 'user', 'built-in'] as const).map((id) => (
            <button
              key={id}
              type="button"
              data-active={sourceFilter === id ? 'true' : 'false'}
              onClick={() => setSourceFilter(id)}
            >
              {id === 'all'
                ? t('templates.sourceAll')
                : id === 'user'
                  ? t('templates.sourceUser')
                  : t('templates.sourceBuiltIn')}
            </button>
          ))}
        </div>
      </div>

      <div
        className="templates-view__category-filters"
        role="group"
        aria-label={t('templates.categoryFilterLabel')}
      >
        <button
          type="button"
          data-testid="templates-category-chip"
          data-category="all"
          data-active={activeCategoryFilter === 'all' ? 'true' : 'false'}
          aria-pressed={activeCategoryFilter === 'all'}
          onClick={() => setCategoryFilter('all')}
        >
          {t('templates.categoryAll')} ({searched.length})
        </button>
        {categoryChips.map((category) => (
          <button
            key={category}
            type="button"
            data-testid="templates-category-chip"
            data-category={category}
            data-active={activeCategoryFilter === category ? 'true' : 'false'}
            aria-pressed={activeCategoryFilter === category}
            onClick={() => setCategoryFilter(category)}
          >
            {categoryLabel(category, t)} ({categoryCounts.get(category)})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="templates-view__empty" role="status">
          {t('templates.empty')}
        </p>
      ) : (
        <div className="templates-view__sections">
          {sections.map(({ category, templates: sectionTemplates }) => (
            <section
              key={category}
              className="templates-view__section"
              data-testid="templates-section"
              data-category={category}
            >
              <header className="templates-view__section-head">
                <h2 className="templates-view__section-title">{categoryLabel(category, t)}</h2>
                <span className="templates-view__section-count">
                  {t('templates.sectionCount', { count: sectionTemplates.length })}
                </span>
              </header>
              <div className="templates-view__grid">
                {sectionTemplates.map((tpl) => (
                  <TemplateCard
                    key={tpl.id}
                    tpl={tpl}
                    locale={locale}
                    t={t}
                    onOpen={(id, el) => {
                      returnFocusRef.current = el;
                      setOpenId(id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {open ? (
        <div
          className="templates-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={localizeSkillName(locale, open)}
          data-testid="templates-viewer"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) setOpenId(null);
          }}
        >
          <div className="templates-viewer__panel" ref={panelRef}>
            <header className="templates-viewer__head">
              <div className="templates-viewer__ident">
                <h2>{localizeSkillName(locale, open)}</h2>
                <p>{localizeSkillDescription(locale, open)}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="templates-viewer__close"
                onClick={() => setOpenId(null)}
                disabled={creating}
                aria-label={t('templates.close')}
              >
                <Icon name="close" size={18} />
              </button>
            </header>

            <div className="templates-viewer__stage">
              {hasHtmlPreview(open) ? (
                <iframe
                  key={open.id}
                  src={exampleUrl(open.id)}
                  title={t('templates.previewAria', {
                    name: localizeSkillName(locale, open),
                  })}
                  sandbox="allow-scripts"
                  data-testid="templates-viewer-frame"
                />
              ) : (
                <p className="templates-viewer__no-preview">{t('templates.noPreview')}</p>
              )}
            </div>

            <footer className="templates-viewer__actions">
              <span className="templates-viewer__facts">
                <span>{open.mode}</span>
                {vendorOf(open) ? <span>{vendorOf(open)}</span> : null}
                <span>{open.source === 'user' ? t('templates.sourceUser') : t('templates.sourceBuiltIn')}</span>
              </span>
              {createFailed ? (
                <span className="templates-viewer__error" role="alert">
                  {t('templates.startFailed')}
                </span>
              ) : null}
              <span className="templates-viewer__buttons">
                {/* Plain anchor, not window.open: the browser owns the tab, and
                    noopener keeps the sandboxed document off `window.opener`. */}
                {hasHtmlPreview(open) ? (
                  <button
                    type="button"
                    className="templates-viewer__link"
                    onClick={() =>
                      openSandboxedUrlInNewTab(
                        exampleUrl(open.id),
                        localizeSkillName(locale, open),
                      )
                    }
                    data-testid="templates-open-live"
                  >
                    <Icon name="external-link" size={15} />
                    {t('templates.openLive')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="templates-viewer__use"
                  disabled={creating}
                  onClick={() => setGuidedOpen(true)}
                  data-testid="templates-use"
                >
                  {creating ? t('templates.starting') : t('templates.use')}
                </button>
              </span>
            </footer>
          </div>
        </div>
      ) : null}
      {guidedOpen && open ? (
        <GuidedCreateDialog
          title={localizeSkillName(locale, open)}
          busy={creating}
          onClose={() => setGuidedOpen(false)}
          onSubmit={(brief) => {
            const template = open;
            setGuidedOpen(false);
            // Keep the overlay open until the project actually exists.
            // Closing on click looked like success even when creation
            // failed, leaving the user with no error and nothing to retry.
            setCreating(true);
            setCreateFailed(false);
            const hasBrief = Object.keys(brief).length > 0;
            void Promise.resolve(onUseTemplate(template, hasBrief ? brief : undefined))
              .then((ok) => {
                if (ok === false) {
                  setCreateFailed(true);
                  return;
                }
                setOpenId(null);
              })
              .catch(() => setCreateFailed(true))
              .finally(() => setCreating(false));
          }}
        />
      ) : null}
    </div>
  );
}
