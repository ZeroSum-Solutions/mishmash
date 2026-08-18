export interface RunContextSelection {
  skillIds?: string[];
  pluginIds?: string[];
  mcpServerIds?: string[];
  connectorIds?: string[];
  workspaceItems?: WorkspaceContextItem[];
}

export type WorkspaceContextKind =
  | 'design-files'
  | 'design-system'
  | 'project'
  | 'local-code'
  | 'file'
  | 'folder'
  | 'project'
  | 'local-code'
  | 'browser'
  | 'terminal'
  | 'side-chat'
  | 'live-artifact';

export interface WorkspaceContextItem {
  id: string;
  kind: WorkspaceContextKind;
  label: string;
  tabId?: string;
  path?: string;
  absolutePath?: string;
  url?: string;
  title?: string;
  /**
   * Free-text "what to take from this" note the user attached to the
   * reference — e.g. "the bento cards" or "the scrolling animations and the
   * WebGL hero". Free text, not a closed vocabulary like
   * `DesignLibraryItem.aspects`: an arbitrary sibling project has no
   * catalog-authored tag list to select from, and the phrasing people
   * actually use here ("the bento cards") is open-ended. Rendered alongside
   * the item so the agent knows both where to look and what to reuse,
   * without pulling the referenced project's files into the prompt.
   */
  intent?: string;
}

export interface ProjectContextPluginRef {
  id: string;
  title: string;
  description?: string;
}

export interface ProjectContextMcpServerRef {
  id: string;
  label?: string;
  transport?: string;
  url?: string;
  command?: string;
}

export interface ProjectContextConnectorRef {
  id: string;
  name: string;
  provider?: string;
  category?: string;
  description?: string;
  status?: string;
  accountLabel?: string;
}

/**
 * A persisted cross-project reference — "Reference project" (UI) or
 * `od project reference` (CLI) — stored on the *referencing* project's
 * `ProjectMetadata.projectReferences` so every future run picks it up
 * automatically, the same way `contextPlugins`/`contextMcpServers` already
 * reach every turn without the composer having to resend them. Each entry
 * also lands its `absolutePath` in `linkedDirs` for filesystem access; this
 * record is the pointer + optional intent layered on top, not a copy of the
 * referenced project's content.
 */
export interface ProjectReferenceRecord {
  /** `project:<targetProjectId>` — matches the `WorkspaceContextItem.id` this record renders as. */
  id: string;
  targetProjectId: string;
  label: string;
  absolutePath: string;
  intent?: string;
  addedAt?: string;
}
