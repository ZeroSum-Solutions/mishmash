import type { ProjectFileKind, ProjectFileVersion } from './files.js';

/**
 * One file version with its stored text attached.
 *
 * `content` is `null` for a kind this daemon does not snapshot as text. Wave 8
 * versions text and HTML only, so a non-text entry reports `null` rather than a
 * base64 payload, and `od run diff` prints "diff not available for <kind>".
 */
export interface RunFileDiffVersion extends ProjectFileVersion {
  content: string | null;
}

/** One file a run changed: the version before it, and the version it wrote. */
export interface RunFileDiffEntry {
  fileName: string;
  kind: ProjectFileKind;
  /** The version immediately preceding the run's FIRST write of the file; `after` is the run's LAST write. `null` when the run created the file. */
  before: RunFileDiffVersion | null;
  after: RunFileDiffVersion;
  /** Who asked for the run, per D-2's client-asserted attribution. `null` when unattributed. */
  actorName: string | null;
  /** When the run's version was written (epoch ms). */
  at: number;
}

/** Body of `GET /api/runs/:id/diff`. */
export interface RunDiffResponse {
  runId: string;
  files: RunFileDiffEntry[];
}
