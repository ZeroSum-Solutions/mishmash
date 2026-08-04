// Design Library — contract for browsing the local curated reference-asset
// library (a Devin-machine `~/Desktop/Design Assets` tree, see
// apps/daemon/src/routes/design-library.ts). Every item is rights-gated via
// `allowed_use`; the web UI must not offer attach/insert/copy affordances for
// anything other than `own-code` / `licensed-source-review` — those two tiers
// may be copied into a new managed project via `start-project` below.
// `human-local-only` items may opt into a prompt-only reference flow when the
// catalog supplies `reference`; their source bytes remain outside the project.
//
// Keep this file pure TypeScript — no Node, browser, or daemon imports.

import type { Project } from './projects.js';

export type DesignLibraryAllowedUse =
  | 'own-code'
  | 'licensed-source-review'
  | 'human-local-only'
  | 'blocked-pending-license';

export interface DesignLibraryItem {
  id: string;
  label: string;
  /** Path relative to the library root, e.g. "01 UI8 Kits/62-screens". */
  rel: string;
  /** Path relative to the library root under `.catalog/thumbs/`, or null. */
  thumb: string | null;
  kind: string;
  files: number;
  size: string;
  category: string;
  domains: string[];
  allowed_use: DesignLibraryAllowedUse;
  /** Rel path of the collection this item duplicates, when known. */
  duplicate_of?: string;
  /**
   * Short curated blurb: the collection's visual style and what it is best
   * used for. Authored in the external library catalog (not by this repo);
   * absent for uncurated items.
   */
  description?: string;
  /** Selectable visual/interaction ingredients, e.g. hero, WebGL, GSAP. */
  aspects?: string[];
  /** Implementation technologies detected in the source reference. */
  stacks?: string[];
  /**
   * Private local source provenance. Paths are relative to `rel` and are
   * resolved by the daemon; they are never exposed as public static files.
   */
  reference?: {
    source: string;
    design: string | null;
    html: string | null;
    design_sha256?: string;
    html_sha256?: string;
  };
}

export interface DesignLibraryGroup {
  title: string;
  folder: string;
  blurb: string;
  items: DesignLibraryItem[];
}

export interface DesignLibraryCatalog {
  library: string;
  rights_ledger: string;
  note: string;
  total_collections: number;
  groups: DesignLibraryGroup[];
  /** Absolute path the daemon read the catalog from (UI provenance label). */
  root: string;
}

export interface DesignLibraryStartProjectRequest {
  /** Path relative to the library root of the catalog item to start from. */
  rel: string;
  name?: string;
  /** Copy a licensed kit, or create a prompt-only project from a private reference. */
  mode?: 'copy' | 'reference';
  /** Optional subset of the item's declared aspects; empty means full design. */
  aspects?: string[];
}

export interface DesignLibraryStartProjectResponse {
  ok: true;
  projectId: string;
  conversationId: string;
  project: Project;
  /** Detected preview entry point relative to the project root, when found. */
  entryFile?: string;
  copiedFiles: number;
  skippedFiles: number;
  warnings: string[];
}
