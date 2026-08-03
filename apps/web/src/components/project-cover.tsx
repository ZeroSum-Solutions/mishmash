import { useEffect, useState } from 'react';
import { projectFileUrl } from '../providers/registry';
import type { ProjectFile } from '../types';

/**
 * W4 — the daemon's rendered, persisted cover image (GET
 * /api/projects/:id/cover). Raw image bytes when a cover has been
 * generated, 404 before the first render — HtmlProjectCoverFrame's
 * onError fallback handles the not-yet-rendered case as a static glyph.
 */
export function renderedCoverUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/cover`;
}

export type ProjectCoverKind = 'html' | 'image' | 'video' | 'logo';

export interface ProjectCoverOverride {
  kind: ProjectCoverKind;
  name: string;
  mtime?: number;
}

export function coverFromProjectFile(
  file: ProjectFile,
  kind: ProjectCoverKind = file.kind as ProjectCoverKind,
): ProjectCoverOverride | null {
  if (kind !== 'html' && kind !== 'image' && kind !== 'video' && kind !== 'logo') return null;
  return { kind, name: file.path ?? file.name, mtime: file.mtime };
}

export function selectProjectFileCover(files: ProjectFile[]): ProjectCoverOverride | null {
  const html =
    files.find((file) => (file.path ?? file.name) === 'index.html') ??
    files
      .filter((file) => file.kind === 'html')
      .sort((a, b) => b.mtime - a.mtime)[0];
  if (html) return coverFromProjectFile(html, 'html');

  const image = files
    .filter((file) => file.kind === 'image')
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (image) return coverFromProjectFile(image, 'image');

  const video = files
    .filter((file) => file.kind === 'video')
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (video) return coverFromProjectFile(video, 'video');

  return null;
}

export function projectCoverUrl(projectId: string, name: string, version?: number): string {
  const url = projectFileUrl(projectId, name);
  if (!Number.isFinite(version) || version === undefined || version <= 0) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(String(Math.trunc(version)))}`;
}

/**
 * Renders an HTML-kind project's cover. S4-5 correction: this used to
 * mount a LIVE sandboxed iframe of the project's raw HTML once a HEAD
 * check verified it existed -- `sandbox="allow-scripts"` (deliberately
 * without `allow-same-origin`, see docs/security/daemon-threat-model.md
 * NM-35C) stops the frame reaching the parent document, but it does
 * nothing to stop the frame's OWN outbound requests: the project's HTML
 * could still pull remote CSS/fonts/scripts/trackers on first card view,
 * well before any real render pipeline existed to police that content
 * (C4-7).
 *
 * Fixed: an `<img>` pointed at the SAME `src` the caller already passes.
 * Browsers never parse HTML bytes as an image, so no script or
 * network-capable frame is ever created regardless of what `src` resolves
 * to -- the not-yet-rendered state falls straight through `onError` into
 * the static glyph. Once a real cover exists (call sites pass
 * `renderedCoverUrl(projectId)`, see above), `src` serves real image
 * bytes and the same `<img>` renders it.
 */
export function HtmlProjectCoverFrame({
  src,
  initial,
  iframeClassName,
  glyphClassName,
  diagnostic,
}: {
  src: string | undefined;
  initial: string;
  iframeClassName: string;
  glyphClassName: string;
  diagnostic: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <span className={glyphClassName}>{initial}</span>;
  }

  return (
    <img
      className={iframeClassName}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => {
        console.warn('[project-cover] cover image unavailable, showing glyph fallback:', diagnostic);
        setFailed(true);
      }}
    />
  );
}
