// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

// FileViewer dispatches to a per-kind sub-viewer (ImageViewer / VideoViewer /
// AudioViewer / TextViewer / DocumentPreviewViewer / BinaryViewer) purely from
// `file.kind` (see the dispatch chain at the top of the FileViewer component).
// Video and audio were previously undispatch-tested — this file closes that gap
// for the two `media-viewers` feature paths that had zero coverage.

function baseFile(overrides: Partial<ProjectFile>): ProjectFile {
  return {
    name: 'asset.png',
    path: 'asset.png',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'image',
    mime: 'image/png',
    ...overrides,
  };
}

describe('FileViewer media viewer dispatch', () => {
  it('routes files with no dedicated viewer to the generic binary fallback with size metadata', () => {
    const file = baseFile({
      name: 'archive.bin',
      path: 'archive.bin',
      kind: 'binary',
      mime: 'application/octet-stream',
      size: 2048,
    });

    const markup = renderToStaticMarkup(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    expect(markup).toContain('class="viewer binary-viewer"');
    expect(markup).toContain('Binary · 2.0 KB');
    expect(markup).toContain('Binary file (2048 bytes)');
    expect(markup).not.toContain('class="viewer image-viewer"');
    expect(markup).not.toContain('class="viewer video-viewer"');
    expect(markup).not.toContain('class="viewer audio-viewer"');
  });

  it('routes video files to the video viewer with a playable <video> element', () => {
    const file = baseFile({
      name: 'clip.mp4',
      path: 'clip.mp4',
      kind: 'video',
      mime: 'video/mp4',
    });

    const markup = renderToStaticMarkup(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    expect(markup).toContain('class="viewer video-viewer"');
    expect(markup).toContain('<video');
    expect(markup).toContain('src="/api/projects/project-1/raw/clip.mp4?v=1710000000"');
    expect(markup).not.toContain('class="viewer image-viewer"');
    expect(markup).not.toContain('class="viewer audio-viewer"');
  });

  it('routes audio files to the audio viewer with a playable <audio> element and the file name', () => {
    const file = baseFile({
      name: 'voiceover.mp3',
      path: 'voiceover.mp3',
      kind: 'audio',
      mime: 'audio/mpeg',
    });

    const markup = renderToStaticMarkup(<FileViewer projectId="project-1" projectKind="prototype" file={file} />);

    expect(markup).toContain('class="viewer audio-viewer"');
    expect(markup).toContain('<audio');
    expect(markup).toContain('src="/api/projects/project-1/raw/voiceover.mp3?v=1710000000"');
    expect(markup).toContain('voiceover.mp3');
    expect(markup).not.toContain('class="viewer video-viewer"');
  });
});
