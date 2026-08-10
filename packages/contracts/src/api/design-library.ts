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

import type { GuidedCreateBrief, Project } from './projects.js';

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
  /**
   * Entry HTML for "open live preview", relative to `rel`, or null when the
   * collection ships no renderable page (a `.fig` source, an image set, a
   * docs bundle). Computed by the daemon when it serves the catalog — it is
   * presentation data that decides whether the UI offers the action, never an
   * authorization input; the live-preview route re-detects and re-authorizes
   * independently.
   */
  entry_html?: string | null;
  /**
   * Additional preview images for the item's detail-view strip, beyond the
   * primary `thumb` — e.g. an alternate Figma-source cover published
   * alongside the generated JPG. Computed by the daemon from files that
   * already exist under `.catalog/thumbs/`; the primary `thumb` is always
   * first when present. Absent, `null`, or a single-element array means the
   * cover is the item's only visual — the detail view must not invent strip
   * entries beyond what this lists.
   */
  gallery?: string[];
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

/**
 * "Open live preview" — hand the collection's entry HTML to the OS default
 * browser as a `file://` document, the way double-clicking it in Finder
 * would. Deliberately NOT an HTTP route that serves library bytes: the page
 * is third-party code, and serving it from the daemon's own origin would let
 * it reach every local `/api/*` route as a same-origin caller. A `file://`
 * document gets an opaque origin instead, so it renders exactly as authored
 * — CDN scripts, fonts, and ES modules included — with no daemon reach.
 */
export interface DesignLibraryLivePreviewRequest {
  /** Path relative to the library root of the catalog item to open. */
  rel: string;
}

export interface DesignLibraryLivePreviewResponse {
  ok: true;
  /** The opened entry HTML, relative to `rel`. */
  entryFile: string;
}

export interface DesignLibraryStartProjectRequest {
  /** Path relative to the library root of the catalog item to start from. */
  rel: string;
  name?: string;
  /** Copy a licensed kit, or create a prompt-only project from a private reference. */
  mode?: 'copy' | 'reference';
  /** Optional subset of the item's declared aspects; empty means full design. */
  aspects?: string[];
  /**
   * The guided create flow's answers (PRD C8), when the caller collected
   * one. Folded server-side into the generated project's starting prompt —
   * see `GuidedCreateBrief` in `./projects.js`.
   */
  brief?: GuidedCreateBrief;
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

export const DESIGN_LIBRARY_PROMOTION_GROUPS = [
  'app-captures',
  'site-capture',
  'site-clone',
] as const;

export type DesignLibraryPromotionGroup =
  (typeof DESIGN_LIBRARY_PROMOTION_GROUPS)[number];

export type DesignLibraryPromotionStatus =
  | 'pending'
  | 'claimed'
  | 'succeeded'
  | 'failed';

export interface DesignLibraryPromotion {
  id: string;
  assetId: string;
  assetContentSha256: string;
  proposedGroup: DesignLibraryPromotionGroup;
  requesterNote?: string;
  status: DesignLibraryPromotionStatus;
  createdAt: number;
  updatedAt: number;
  curatorId?: string;
  leaseExpiresAt?: number;
  claimable: boolean;
  completedAt?: number;
  finalRel?: string;
  sourceSha256?: string;
  treeSha256?: string;
  catalogGeneration?: string;
  error?: { code: string; message: string };
}

export interface CreateDesignLibraryPromotionRequest {
  assetId: string;
  proposedGroup: DesignLibraryPromotionGroup;
  requesterNote?: string;
  idempotencyKey: string;
}

export interface CreateDesignLibraryPromotionResponse {
  promotion: DesignLibraryPromotion;
  deduped: boolean;
}

export type DesignLibraryPromotionListStatus =
  | 'claimable'
  | DesignLibraryPromotionStatus
  | 'all';

export interface DesignLibraryPromotionsResponse {
  promotions: DesignLibraryPromotion[];
}

export type PatchDesignLibraryPromotionRequest =
  | { action: 'claim'; curatorId: string; leaseMs?: number }
  | {
      action: 'acknowledge';
      leaseToken: string;
      outcome: 'succeeded';
      finalRel: string;
      sourceSha256: string;
      treeSha256: string;
      catalogGeneration: string;
    }
  | {
      action: 'acknowledge';
      leaseToken: string;
      outcome: 'failed';
      error: { code: string; message: string };
      sourceSha256?: string;
      treeSha256?: string;
      catalogGeneration?: string;
    };

export type PatchDesignLibraryPromotionResponse =
  | { promotion: DesignLibraryPromotion; leaseToken: string }
  | { promotion: DesignLibraryPromotion };
