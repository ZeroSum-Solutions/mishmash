// Gallery visibility contract for the Workflows and Assets grid.
//
// Atoms are infrastructure pieces (`code-import`, `patch-edit`) that are
// not user-facing on the home grid. `scenario`-TAGGED plugins are flow
// definitions dispatched by id (the od-* flows, the share actions, the
// home-hero clone/deck entries) — they must stay installed but never
// render as tiles. (`od.kind === 'scenario'` is NOT the discriminator:
// most catalog items are scenario-kind pipelines; only the tag marks the
// flows.)

export interface GalleryVisibilityRecord {
  manifest?: {
    od?: { kind?: string };
    tags?: readonly string[];
  } | null;
}

export function isGalleryVisiblePlugin(p: GalleryVisibilityRecord): boolean {
  return p.manifest?.od?.kind !== 'atom' && !(p.manifest?.tags ?? []).includes('scenario');
}
