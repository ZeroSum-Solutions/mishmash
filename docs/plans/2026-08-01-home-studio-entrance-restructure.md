# Home "studio entrance" restructure — council design + phased plan

Date: 2026-08-01 · Branch: `feat/workflows-and-assets` · Status: phase 1 in progress

## Origin

Owner request: hide/collapse the Home "Workflows and Assets" gallery; build out the
"Featured starters" section; design the zero-friction agency flow (kit/brand in → site
out → host). Design settled by a 3-model LLM council (Claude Fable 5, Gemini 3.1 Pro,
GPT-5.6), two rounds each (positions + cross-examination), synthesized and approved by the
owner via a before/after wireframe review (Snip, status: approved).

## Council verdict

Governing rule: **an element earns Home space only if it starts or resumes a project.**
"Home is a studio entrance, not an app store."

Unanimous:
- Workflows & Assets grid leaves Home entirely; a single quiet link-out row replaces it
  (no accordion — "collapsed junk is still junk"). Full gallery remains on the Plugins
  view (`changeView('plugins')`), unchanged.
- Starters is THE Home section: curated ~8 cards, 2×4; curation over filters; no tabs.
- The design-library catalog stays its own route (`/design-library`); the shelf ends in a
  "Browse the kit library" tail card that navigates there.
- Hosting: project-header Host/Publish (canonical) + Republish quick action on recent
  cards; recent cards gain Live/Draft badges once hosting state exists.
- Power lane: ⌘K palette + drag-drop onto the composer + sticky per-client defaults.

Split (2–1) + synthesis:
- Client brand is a first-class object referencing (not merged into) a design system;
  surfaced through ONE evolved composer-footer picker, never a second dropdown.
- No modal Project-Setup sheet on starter click (voted down as a wizard); the anti-black-
  box requirement lands as a visible build plan rendered as the project's first message.
- Brand extraction from URL is always explicit intent — never auto-extract on paste
  (trade-dress hazard; clone sources must never silently become client identity).

## Phases

### Phase 1 — pure UI (this change)
- `HomeView`: remove the `PluginsHomeSection` render (Home only; the component and its
  use on `PluginsView` are untouched) → new `WorkflowsLinkRow` ("All workflows &
  assets →" via the existing `onBrowseRegistry` → Plugins view). The plugin details
  modal stays (HomeHero still opens it); only the gallery-specific opener goes.
- `FeaturedTemplatesRow` per approved wireframe: templates row unchanged (Dwell, Morrow,
  Azurio, Core 2); tools row becomes Scroll film · Hero creation · Clone + rebrand ·
  "Browse the kit library" tail card (→ `/design-library`). Web shells and Scroll
  animations cards leave the shelf (both remain available as plugins/scenarios).
  Clone + rebrand card drives the existing `web-clone` chip via `pickChip` — the same
  path the rail uses; no new mechanism.
- i18n: keys added/removed accordingly (`types.ts` + `en.ts`).
- **Plugins view gallery tab** (added after the Playwright suite caught a real
  regression): the installed tab filters to user-imported plugins, so removing the Home
  grid left the bundled catalog with no surface anywhere. `PluginsView` gains a
  `gallery` tab — now the default landing tab — rendering `PluginsHomeSection` in
  gallery layout over the full catalog, with browse-registry switching to Available.
  The Home link-out therefore lands directly on the catalog. Analytics contract
  `CommunityGalleryClickProps.page_name` widened to `'home' | 'plugins'`, and
  `PluginsTopClickProps.element` gains `'gallery_tab'`.
- Deferred within phase 1: recent-card status badges (need hosting state; a Draft-only
  badge is noise — revisit in phase 3).

### Phase 2 — Client brand (mostly surfacing, not building)
Discovery during implementation: upstream already has brand objects (`BrandSummary`,
`fetchBrands`, `useBrandExtract` URL extraction, `NewBrandModal`, Brands tab) and has
already merged brand creation into the design-system create wizard
(`design-system-create`, "start from a brand" picker). Phase 2 is therefore: evolve the
composer-footer design-system picker into the client-brand picker and wire extraction
review — extending existing objects, not inventing parallel ones.

### Phase 3 — Publish capability (net-new)
`od publish` + `/api/publish` + project-header Host + recent-card Republish; provider
choice pending owner decision (Vercel / Cloudflare / managed subdomain). UI/CLI
dual-track applies.

### Phase 4 — ⌘K command palette.

## Council artifacts

Round 1 + round 2 transcripts and the approved wireframe live in the session scratchpad
(`council/` — fable-r1/r2, gemini-r1/r2, terra-r1/r2, home-wireframe.html); votes are
summarized above. Not committed — this doc is the durable record.
