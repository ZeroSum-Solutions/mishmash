// One asset card + its kind-aware thumbnail — extracted out of LibrarySection
// so the page orchestrator stays focused on data/layout. Shared by the flat
// grid and the date-grouped grid.

import { memo, useEffect, useRef, useState } from 'react';
import type { LibraryAsset } from '@open-design/contracts';
import { libraryAssetRawUrl } from '../../providers/registry';
import { useInView } from '../plugins-home/useInView';
import { navigate } from '../../router';
import {
  KindIcon,
  SOURCE_LABELS,
  assetTitle,
  badgeKind,
  fontFamilyFor,
  kindLabel,
  kindTint,
  originDesignSystemId,
  originProjectId,
  primarySource,
} from '../LibraryAssetMeta';
import styles from './LibraryCard.module.css';

// Image / video / html / design-system thumbnail with a shimmer-until-loaded
// skeleton, mirroring the clipper's "Select images to save" picker
// (clipper/content.js → `.thumb.shim`). The skeleton fills the 4:3 box and
// animates only while the bytes are in flight; the media fades in over it on
// `load`, then the skeleton unmounts. On `error` the skeleton also clears so a
// broken asset doesn't shimmer forever, and a cached image that finished
// loading before React attached `onLoad` is caught via the `complete` probe on
// mount. Because heavy kinds are gated by {@link LibraryThumb} (which only
// mounts in view) and `.card` carries `content-visibility:auto`, no off-screen
// card runs the shimmer animation.
function MediaThumb({ asset }: { asset: LibraryAsset }) {
  const [loaded, setLoaded] = useState(false);
  const rawUrl = libraryAssetRawUrl(asset.id);
  const title = assetTitle(asset);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  const flag = loaded ? 'true' : 'false';
  let media: React.ReactNode;
  if (asset.kind === 'video') {
    media = (
      <>
        <video
          className={styles.thumbImg}
          src={rawUrl}
          muted
          preload="metadata"
          playsInline
          data-loaded={flag}
          onLoadedData={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
        <span className={styles.playGlyph} aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </>
    );
  } else if (asset.kind === 'html' || asset.kind === 'design-system') {
    // Static (no scripts) sandboxed render — a faithful, lightweight preview
    // of the captured page. The modal re-renders it with scripts for motion.
    media = (
      <iframe
        className={styles.thumbFrame}
        src={rawUrl}
        sandbox=""
        scrolling="no"
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        title={title}
        data-loaded={flag}
        onLoad={() => setLoaded(true)}
      />
    );
  } else {
    media = (
      <img
        ref={imgRef}
        className={styles.thumbImg}
        src={rawUrl}
        alt={title}
        loading="lazy"
        decoding="async"
        data-loaded={flag}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    );
  }

  return (
    <>
      {loaded ? null : <span className={styles.thumbSkeleton} aria-hidden />}
      {media}
    </>
  );
}

/** Kind-aware thumbnail. Stays fetch-free so the grid scrolls cheaply. */
function Thumb({ asset }: { asset: LibraryAsset }) {
  switch (asset.kind) {
    case 'image':
    case 'video':
    case 'design-system':
    case 'html':
      return <MediaThumb asset={asset} />;
    case 'font':
      return (
        <div className={styles.thumbFont} style={{ fontFamily: `"${fontFamilyFor(asset.id)}", sans-serif` }}>
          Ag
        </div>
      );
    case 'color': {
      const swatch = asset.palette?.find((c) => typeof c === 'string' && c.trim());
      return swatch ? (
        <div className={styles.thumbColor} style={{ background: swatch }} />
      ) : (
        <div className={styles.thumbGlyph}>
          <KindIcon kind="color" size={34} />
        </div>
      );
    }
    case 'text':
    case 'url':
    default:
      return (
        <div className={styles.thumbGlyph}>
          <KindIcon kind={asset.kind} size={34} />
        </div>
      );
  }
}

// Kinds whose thumbnail does real off-screen work — a network fetch (image,
// video, font face) or a whole browsing context (html `<iframe>`). These mount
// lazily; cheap kinds (color swatch / text / url glyph) render immediately.
const LAZY_THUMB_KINDS = new Set<string>(['image', 'video', 'design-system', 'html', 'font']);

// Wraps {@link Thumb} so the heavy content (full-bytes `<img>`/`<video>`, the
// `<iframe>` html preview, or an injected `@font-face` specimen) only mounts
// once the card scrolls near the viewport. Until then a faint kind glyph holds
// the 4:3 box. `once: true` keeps it mounted after first reveal so scrolling
// back does not tear down and recreate an iframe browsing context. The wrapper
// fills the `.thumb` box without changing the card's outer dimensions, so the
// flat `index` and box-select rects stay stable whether or not it has mounted.
function LibraryThumb({ asset }: { asset: LibraryAsset }) {
  const lazy = LAZY_THUMB_KINDS.has(asset.kind);
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, rootMargin: '300px' });
  if (!lazy) return <Thumb asset={asset} />;
  return (
    <div ref={ref} className={styles.thumbLazy}>
      {inView ? (
        <Thumb asset={asset} />
      ) : (
        <div className={styles.thumbGlyph} aria-hidden>
          <KindIcon kind={badgeKind(asset)} size={34} />
        </div>
      )}
    </div>
  );
}

export interface LibraryCardProps {
  asset: LibraryAsset;
  /** Flat position in `assets` — drives shift-range + box selection. */
  index: number;
  selected: boolean;
  /** The grid/day-group has an active selection — keeps the checkbox visible
      on every card, not just the hovered one. */
  selecting: boolean;
  /** This card's asset is mid "Edit as page" (spinner gate). */
  editing: boolean;
  onToggle: (id: string, index: number) => void;
  onRange: (index: number) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  onEditAsPage: (id: string) => void;
  onOpenProject: (projectId: string, fileName?: string) => void;
}

// One asset card. Shared by the flat grid and the date-grouped grid. Memoized
// so a selection change — including the per-frame `setSelectedIds` of a
// rubber-band drag — only re-renders the cards whose `selected`/`editing`
// actually flipped, not the whole grid. On a large Library that
// turn-the-whole-list re-render was the single biggest cost; all the
// callbacks below are stable (useCallback / setState) so React.memo's shallow
// compare holds across those updates.
export const LibraryCard = memo(function LibraryCard({
  asset,
  index,
  selected,
  selecting,
  editing,
  onToggle,
  onRange,
  onPreview,
  onDelete,
  onEditAsPage,
  onOpenProject,
}: LibraryCardProps) {
  const src = primarySource(asset);
  const projectId = originProjectId(asset);
  const designSystemId = originDesignSystemId(asset);
  const title = assetTitle(asset);
  return (
    <figure
      className={styles.card}
      data-asset-card
      data-asset-id={asset.id}
      data-selected={selected ? 'true' : 'false'}
      data-selecting={selecting ? 'true' : 'false'}
    >
      <div className={styles.thumb}>
        <LibraryThumb asset={asset} />
        <button
          type="button"
          className={styles.thumbButton}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              onToggle(asset.id, index);
              return;
            }
            if (e.shiftKey) {
              onRange(index);
              return;
            }
            onPreview(asset.id);
          }}
          aria-label={`Preview ${title}`}
        >
          <span className={styles.previewOverlay} aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className={styles.selectCheck}
          data-checked={selected ? 'true' : 'false'}
          aria-pressed={selected}
          aria-label={selected ? 'Deselect asset' : 'Select asset'}
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey) onRange(index);
            else onToggle(asset.id, index);
          }}
        >
          {selected ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : null}
        </button>
        {src ? (
          <span className={styles.badge} data-source={src}>
            {SOURCE_LABELS[src]}
          </span>
        ) : null}
        <span
          className={styles.kindBadge}
          style={{ ['--kind-tint' as string]: kindTint(badgeKind(asset)) }}
        >
          <KindIcon kind={badgeKind(asset)} size={12} />
          {kindLabel(badgeKind(asset))}
        </span>
      </div>
      <figcaption className={styles.meta}>
        <button
          type="button"
          className={styles.title}
          title={asset.sourceTitle ?? asset.sourceUrl ?? asset.id}
          onClick={() => onPreview(asset.id)}
        >
          {title}
        </button>
        <span className={styles.sub}>
          {asset.width && asset.height
            ? `${asset.width}×${asset.height}`
            : kindLabel(badgeKind(asset))}
        </span>
      </figcaption>
      <div className={styles.cardActions}>
        {/* Jump back to an asset's origin. A synced design-system / project
            asset links to where it lives; a clipper html capture (no origin)
            still offers "Edit as page"; otherwise the external source. */}
        {designSystemId ? (
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => navigate({ kind: 'design-system-detail', designSystemId })}
          >
            Open design system
          </button>
        ) : projectId ? (
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => onOpenProject(projectId, asset.relPath)}
          >
            Open project
          </button>
        ) : asset.kind === 'html' ? (
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => onEditAsPage(asset.id)}
            disabled={editing}
          >
            {editing ? 'Opening…' : 'Edit as page'}
          </button>
        ) : asset.sourceUrl ? (
          <a className={styles.linkBtn} href={asset.sourceUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        ) : (
          <span />
        )}
        <button type="button" className={styles.deleteBtn} onClick={() => onDelete(asset.id)}>
          Remove
        </button>
      </div>
    </figure>
  );
});
