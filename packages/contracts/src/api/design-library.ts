// Design Library — read-only contract for browsing the local curated
// reference-asset library (a Devin-machine `~/Desktop/Design Assets` tree,
// see apps/daemon/src/routes/design-library.ts). Every item is rights-gated
// via `allowed_use`; the web UI must not offer attach/insert/copy affordances
// for anything other than `own-code` / `licensed-source-review`.
//
// Keep this file pure TypeScript — no Node, browser, or daemon imports.

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
