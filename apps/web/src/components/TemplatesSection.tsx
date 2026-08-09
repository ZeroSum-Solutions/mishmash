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
import type { SkillSummary } from '@open-design/contracts';
import { Icon } from './Icon';
import { useI18n, useT } from '../i18n';
import { localizeSkillDescription, localizeSkillName } from '../i18n/content';

type SourceFilter = 'all' | 'user' | 'built-in';

interface Props {
  templates: SkillSummary[];
  /** Rendered only when the view is on screen — keeps offscreen iframes unmounted. */
  active: boolean;
  onUseTemplate: (template: SkillSummary) => void;
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
function TemplateThumb({ id, title }: { id: string; title: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <span
      className={`templates-card__thumb${posterFailed ? '' : ' templates-card__thumb--poster'}`}
      ref={ref}
    >
      {!visible ? null : posterFailed ? (
        <iframe src={exampleUrl(id)} title={title} sandbox="allow-scripts" tabIndex={-1} aria-hidden="true" />
      ) : (
        <img src={posterUrl(id)} alt="" loading="lazy" onError={() => setPosterFailed(true)} />
      )}
      {/* Transparent overlay: keeps pointer/scroll events inside the frame
          from reaching the template so the card owns every click. */}
      <span className="templates-card__thumb-veil" aria-hidden="true" />
    </span>
  );
}

function vendorOf(t: SkillSummary): string | null {
  if (t.source !== 'user') return null;
  const dash = t.id.indexOf('-');
  return dash > 0 ? t.id.slice(0, dash) : null;
}

export function TemplatesSection({ templates, active, onUseTemplate }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...templates].sort((a, b) =>
        localizeSkillName(locale, a).localeCompare(localizeSkillName(locale, b)),
      ),
    [templates, locale],
  );

  const shown = useMemo(() => {
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

  const open = useMemo(
    () => (openId ? (templates.find((tpl) => tpl.id === openId) ?? null) : null),
    [openId, templates],
  );

  // Close the overlay on Escape. Bound only while something is open so the
  // gallery does not swallow Escape for the rest of the shell.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
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

      {shown.length === 0 ? (
        <p className="templates-view__empty" role="status">
          {t('templates.empty')}
        </p>
      ) : (
        <div className="templates-view__grid">
          {shown.map((tpl) => {
            const name = localizeSkillName(locale, tpl);
            const vendor = vendorOf(tpl);
            return (
              <button
                key={tpl.id}
                type="button"
                className="templates-card"
                // The card wraps an aria-hidden preview frame, which leaves
                // the computed name unreliable; state it outright.
                aria-label={name}
                onClick={() => setOpenId(tpl.id)}
                data-testid="templates-card"
                data-template-id={tpl.id}
              >
                {hasHtmlPreview(tpl) ? (
                  <TemplateThumb id={tpl.id} title={t('templates.previewAria', { name })} />
                ) : (
                  <span className="templates-card__thumb templates-card__thumb--none">
                    {t('templates.noPreview')}
                  </span>
                )}
                <span className="templates-card__body">
                  <span className="templates-card__title">{name}</span>
                  <span className="templates-card__meta">
                    <span className="templates-card__mode">{tpl.mode}</span>
                    {vendor ? <span>{vendor}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
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
            if (e.target === e.currentTarget) setOpenId(null);
          }}
        >
          <div className="templates-viewer__panel">
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
              <span className="templates-viewer__buttons">
                {/* Plain anchor, not window.open: the browser owns the tab, and
                    noopener keeps the sandboxed document off `window.opener`. */}
                {hasHtmlPreview(open) ? (
                  <a
                    className="templates-viewer__link"
                    href={exampleUrl(open.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="templates-open-live"
                  >
                    <Icon name="external-link" size={15} />
                    {t('templates.openLive')}
                  </a>
                ) : null}
                <button
                  type="button"
                  className="templates-viewer__use"
                  onClick={() => {
                    onUseTemplate(open);
                    setOpenId(null);
                  }}
                  data-testid="templates-use"
                >
                  {t('templates.use')}
                </button>
              </span>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
