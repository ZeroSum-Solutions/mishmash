import { useEffect, useState } from 'react';
import { projectFileUrl } from '../providers/registry';
import type { Project, ProjectFile } from '../types';

/**
 * W4 — the daemon's rendered, persisted cover image (GET
 * /api/projects/:id/cover). Raw image bytes when a cover has been
 * generated, 404 before the first render. Call `renderedCoverSrc` rather
 * than this: it is what decides whether the request happens at all.
 */
export function renderedCoverUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/cover`;
}

/**
 * INVARIANT: the web requests a project's rendered cover only when the daemon
 * has told it one exists (`Project.hasCover`). That route is frozen as "raw
 * image bytes 200, or 404", so requesting it before the first render is a
 * guaranteed 404 — and `observability/request-health.ts` files every one as a
 * `resource-failed` anomaly, which fills the log with one row per project
 * card during entirely ordinary use.
 *
 * `undefined` here is the not-yet-rendered state: `HtmlProjectCoverFrame`
 * renders its static glyph for it without touching the network, the same
 * thing the `onError` fallback used to produce after the failed request.
 */
export function renderedCoverSrc(project: Pick<Project, 'id' | 'hasCover'>): string | undefined {
  return project.hasCover === true ? renderedCoverUrl(project.id) : undefined;
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
 * to -- a src that fails falls straight through `onError` into the static
 * glyph. Call sites pass `renderedCoverSrc(project)` (see above), so an
 * absent `src` means the daemon reports no cover and the glyph renders with
 * no request; a present one serves real image bytes, and `onError` still
 * covers a reported cover whose bytes fail to load.
 */
export function HtmlProjectCoverFrame({
  src: coverSrc,
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
  }, [coverSrc]);

  if (!coverSrc || failed) {
    return <span className={glyphClassName}>{initial}</span>;
  }

  return (
    <span className="cover-thumb-frame">
      <img
        className={iframeClassName}
        src={coverSrc}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => {
          console.warn('[project-cover] cover image unavailable, showing glyph fallback:', diagnostic);
          setFailed(true);
        }}
      />
    </span>
  );
}
