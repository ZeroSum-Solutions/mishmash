# UI8 kit starters + home "Workflows and Assets" restructure (2026-08-01)

Branch `feat/workflows-and-assets`; main stays frozen for the partner demo. Three parallel
worktree streams, merged back in order A → C → B, then the Luna → terra adversarial review
protocol from the 2026-07-30 pass.

## Rights basis (binding)

UI8 kits under `~/Desktop/Design Assets/01 UI8 Kits/` are `licensed-source-review`
(RIGHTS.md): adaptable into end products; the kit archive itself never enters any git tree.
Therefore: kits are **copied at runtime** from the library into managed projects (under the
daemon data root, gitignored). No kit bytes are ever committed. `human-local-only` and
`blocked-pending-license` tiers keep zero copy affordances.

## Stream A — kit starter seam (`wt/kit-starter`)

New capability: click a licensed kit → new project scaffolded from its files.

- **Daemon** `apps/daemon/src/routes/design-library.ts`: add
  `POST /api/design-library/start-project` taking `{ rel: string, name?: string }`.
  - Resolve `rel` against `designLibraryRoot()` with the file's existing `withinReal`
    containment checks; look the item up in `catalog.json`; 403 unless `allowed_use` is
    `licensed-source-review` or `own-code`; 404 for unknown rel.
  - Copy via a shared helper extracted from
    `apps/daemon/src/plugins/duplicate-project.ts:copyDirectoryContents` into
    `apps/daemon/src/copy-directory.ts` (both callers keep semantics: skip `.git`,
    `node_modules`, `.DS_Store`, `__MACOSX`; reject symlinks; per-caller caps —
    plugins keep 3000/160MB, design-library uses 6000 files / 600MB to fit the
    largest kits).
  - `ensureProject` + `insertProject` + `insertConversation` exactly as
    `routes/plugins/index.ts:182-267` does; cleanup on failure; response shape
    `{ ok, projectId, conversationId, project, entryFile?, copiedFiles, skippedFiles, warnings }`.
  - `entryFile`: first of `index.html`, `HTML/index.html`, `build/index.html`,
    `template/index.html`, else first `*.html` at depth ≤ 2, else undefined.
- **Contract** `packages/contracts/src/api/design-library.ts`: request/response types.
  Pure TS only.
- **Web** `apps/web/src/components/DesignLibrarySection.tsx`: second card action
  ("Use as template") rendered only for the two permitted tiers; wire through a new
  `startDesignLibraryProject(rel, name?)` helper in `apps/web/src/providers/registry.ts`;
  on success `navigate({ kind: 'project', projectId, conversationId })` like
  `HomeView.tsx:1268`. Update the file-header invariant comments (route + component) to
  state the new tier-gated copy rule.
- **CLI** `apps/daemon/src/cli.ts`: `od design-library start-project --rel <rel>
  [--name <name>] [--json]` (dual-track rule; same endpoint).
- **i18n**: new keys in `types.ts` + `en.ts` (button label, busy state, error toast).
- **Tests**: extend `apps/daemon/tests/design-library/routes.test.ts` (happy copy, tier
  403, traversal/symlink rejection, caps, unknown rel 404) using the
  `OD_DESIGN_LIBRARY_DIR` fixture pattern; update
  `apps/web/tests/components/DesignLibrarySection.test.tsx` (the one-button
  assertion becomes tier-conditional); new unit coverage for the extracted copy helper.

## Stream C — Scroll Film tool (`wt/scroll-film`)

New generation tool: user gives an idea → agent generates a **long-form scroll-driven
story site** (the page is one continuous narrative that plays as the user scrolls).

- **Plugin** `plugins/_official/scenarios/od-scroll-film/` (id `od-scroll-film`),
  `scenario`-tagged (hidden from the gallery roster; surfaced by the home tools row).
  Manifest + `SKILL.md`: the generation protocol — narrative beats from the idea,
  scene-by-scene scroll choreography (pin/scrub/parallax/reveal), GSAP ScrollTrigger
  **code generation only** (design authority: no visual motion-authoring UI; global
  `--motion` multiplier stays the only visual control), reduced-motion fallback,
  self-contained single-file output, no CDN/network.
- Draw structure from the two existing precedents: the velar tile's hand-built scroll
  recipe (`plugins/_official/examples/velar-luxury-real-estate/open-design.json`) and
  `skills/gsap-scrolltrigger`.
- **Preview**: self-contained HTML tile preview per house standards (sandbox-safe,
  animates at frame 0, reduced-motion aware, English-only).
- **Tests**: bundled-roster test hidden-flow roster 17 → 18 (`od-scroll-film`);
  manifest validity e2e already sweeps `plugins/_official/**`.

## Stream B — home featured row (`wt/home-restructure`)

Keep `HomeHero` (chat + chip rail) untouched. Inside the "Workflows and Assets" region
(`HomeView.tsx:2241-2258`), add a **featured row above the grid** (sibling component, the
`RecentProjectsStrip` pattern — do not fight `usePluginFacets`):

- **`FeaturedTemplatesRow`** (new component + CSS module):
  - Four UI8 template cards, one click → `startDesignLibraryProject(rel)` → navigate:
    - `01 UI8 Kits/dwell` — "Dwell — Real-estate site (Next.js)"
    - `01 UI8 Kits/morrow-architecture-website-template` — "Morrow — Architecture site (Next.js)"
    - `01 UI8 Kits/azurio-digital-agency-and-personal-portfolio-html-template` — "Azurio — Agency/portfolio (HTML)"
    - `01 UI8 Kits/core-2-dashboard-builder-react` — "Core 2 — SaaS dashboard (React)"
    - Thumbs via `designLibraryThumbUrl` from the catalog fetch; label + one-line
      descriptor + "UI8 licensed" badge.
  - Four tool cards alongside:
    - **Hero creation** → seeds the composer with a hero-section brief bound to
      `example-curl-field-hero` (the HomeHero preset mechanism chips already use).
    - **Web shells** → binds `example-web-prototype`.
    - **Scroll animations** → seeds a scroll-animation brief (gsap-scrolltrigger lane).
    - **Scroll film** → binds `od-scroll-film` (Stream C).
- Degrade gracefully: if the design-library catalog 404s (library absent), the template
  cards hide and the tools row remains.
- **i18n** keys for the row title, card descriptors, badge. English-only.
- **Tests**: new component test (cards render, tier badge, catalog-absent fallback,
  click handlers), HomeView mount test update if the roster of home sections is pinned
  anywhere.

## Merge + verification order

1. A → `feat/workflows-and-assets` (suites: daemon + web + guard + typecheck).
2. C → same (roster test updated here).
3. B → same (depends on A's endpoint + C's plugin id).
4. Full: `pnpm guard`, `pnpm typecheck`, `pnpm --filter @open-design/daemon test`,
   `pnpm --filter @open-design/web test`, e2e bundled-manifest guard.
5. Review protocol: GPT-5.6 **Luna** first pass (fast, whole diff) → fix → GPT-5.6
   **terra xhigh adversarial** rounds until APPROVE. Suites re-run after each fix round.
6. Deliverable note updated in `~/Inbox/notes/`; reference-repo research appended when
   the research workflow lands.

## Non-goals

- No Figma-render pipeline for `.fig`-only kits (they stay browse/open-only).
- No new allowed-use tier: `licensed-source-review` already permits adaptation per
  RIGHTS.md; the route comment documents the copy rule instead.
- No motion-authoring UI of any kind (design authority, GSAP licence).
- No changes to `HomeHero` chip rail or the 90-tile visible gallery roster (Stream C's
  plugin is hidden; the featured row is a separate surface).
