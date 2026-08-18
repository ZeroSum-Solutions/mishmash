// Cross-project reference — "Reference project" (UI, ProjectReferenceModal)
// and `od project reference` (CLI) both call POST
// /api/projects/:id/reference, the single endpoint that resolves the
// referenced project's directory, links it into the *referencing* project's
// `metadata.linkedDirs`, and persists a `ProjectReferenceRecord` (path +
// optional intent) so the agent picks it up on every future turn via
// `projectMetadataContextSelection`. See `./context.js` for the record shape.
//
// Keep this file pure TypeScript — no Node, browser, or daemon imports.

import type { WorkspaceContextItem } from './context.js';
import type { Project } from './projects.js';

export interface ProjectReferenceRequest {
  targetProjectId: string;
  /**
   * Free-text description of what to take from the referenced project, e.g.
   * "the bento cards" or "the scrolling animations and the WebGL hero".
   * Optional — a reference is valid with no intent at all.
   */
  intent?: string;
}

export interface ProjectReferenceResponse {
  ok: true;
  /** The referencing project, with the reference persisted in its metadata. */
  project: Project;
  /** The referenced project. */
  targetProject: Project;
  /** The referenced project's resolved, materialized directory. */
  resolvedDir: string;
  /** Ready to stage as run context immediately (carries `intent` when supplied). */
  workspaceItem: WorkspaceContextItem;
}
