# Workflows and Assets — section rename + gallery curation (443 → 90) + reference-repo research

**Date:** 2026-07-30 · **Branch:** `feat/workflows-and-assets` (stacked on `fix/plugin-gallery-debrand`; `main` stays frozen until after the partner demo)
**Decided with Devin:** keep total = **90** (~50 website / ~20 app / ~10 emblem / ~10 hyper frames) — the "50" headline in the brief was superseded by the explicit 50/20/10/10 split.
**Review protocol (Devin-mandated):** GPT-5.6 (codex CLI) as adversarial reviewer + Grok 4.5 (`x-ai/grok-4.5` via OpenRouter, lane-verified live) as independent verifier for every interface change.

## 1. Rename: Community → Workflows and Assets

The rendered title is the i18n fallback `pluginsHome.title` (`apps/web/src/i18n/locales/en.ts:891`) consumed by THREE call sites; only the HomeView one is in scope. Editing the shared string would silently rename an unrelated source badge in `FileWorkspace.tsx:5844` and break `plugins-home-section.test.tsx:234`.

**Implementation (hazard-free):**
- Add new key `home.workflowsAndAssetsTitle: 'Workflows and Assets'` to `en.ts` (+ `i18n/types.ts`).
- Pass `title={t('home.workflowsAndAssetsTitle')}` at the HomeView `<PluginsHomeSection>` call site (~line 2244) ONLY.
- Update `designFiles.usefulInfoTip5` (`en.ts:2596`) — it names the section ("…from Community on the Home page").
- `pluginsHome.title` itself stays untouched; existing tests unaffected.

## 2. Curation mechanics (why folder deletion, not API uninstall)

Recon findings (verified in code + against the live daemon):
- 457 DB rows = 455 `bundled` (fsPath = repo `plugins/_official/**`) + 2 user-installed. UI shows 443 = 457 − 1 hidden (`od-default`) − 13 `atom`-kind infrastructure plugins.
- `POST /api/plugins/:id/uninstall` is **not durable for bundled plugins**: it deletes the DB row but the folder lives outside `userPluginsRoot`, and `registerBundledPlugins` re-walks `plugins/_official/**` on EVERY boot, re-upserting anything whose folder exists.
- The durable path is the one the code was built for: **delete folders → restart → `pruneRemovedBundledPlugins` drops exactly the rows whose folders are gone** (scoped to `source_kind='bundled'`; timestamps of survivors preserved by the content-digest cache).
- The registry JSON (`plugins/registry/official/open-design-marketplace.json`, 410 entries) is a separate hand-curated "Browse registry" surface; the seed merge only ADDS bundled entries, never subtracts — so it must be pruned in the same pass or it advertises ~320 ghosts.

**Survivors regardless of the 90 (invisible infrastructure, never gallery tiles):** 13 atoms (`build-test`, `code-import`, `critique-theater`, `design-extract`, `diff-review`, `direction-picker`, `discovery-question-form`, `figma-extract`, `handoff`, `patch-edit`, `rewrite-plan`, `todo-write`, `token-map`) + hidden `od-default` (DEFAULT_UNSELECTED_SCENARIO_PLUGIN_ID — deleting it breaks the composer default path).

**Non-bundled (handled separately):**
- `community-hallmark` (github-sourced): fsPath already dead (points at a pre-rename repo path) — broken card, not selected → uninstall via API (durable for non-bundled).
- `designbybrandin-clone-clone-notes-ms2meya2` (local): Devin's own clone-notes artifact, not catalog clutter → **kept**, so the visible gallery lands at 91 tiles (90 curated + this).

**Sequence:** back up `.od/app.sqlite{,-wal,-shm}` → `tools-dev` stop → prune registry JSON to keepers → `git rm -r` the 351 non-kept folders → restart → verify `/api/plugins` reconciles to 106 rows (90 + 14 infra + 2 non-bundled) → uninstall hallmark → i18n rename → tests (`pnpm guard`, plugins-home web tests, e2e manifest-quality) → DOM verify → commit → codex adversarial → Grok verify.

**Known-benign residue (deliberate):** orphaned baked-preview entries in `.od/plugin-previews/manifest.json`; orphan ids in `open-design:saved-plugin-ids` localStorage; weekly popularity refresh will drop retired ids on its own.

**Selection method:** 8 parallel judge agents scored all 457 (category + keepScore 0–10 + demoWow) against "genuinely useful/beautiful/reusable for a 4-person team shipping production sites/apps on Vercel"; product-curated ids from `curatedPriority.ts` biased in; website tail hand-tuned (pricing/waitlist page patterns + style systems over brand-specific refs). The catalog contains **no true app-icon/emblem generators** — the emblem bucket is filled with the 10 most professional Profile/Avatar identity templates; a real icon/emblem generator plugin is a noted gap worth building later. The 5 `CURATED_HYPERFRAMES_PLUGIN_IDS` in `curatedPriority.ts` reference plugins that don't exist in the catalog at all (pre-existing dead refs, null-safe).

## 3. The 90 (by bucket)

See `docs/plans/2026-07-30-workflows-and-assets-keep-list.md` (generated alongside this plan) for the full 90-item list with scores, and the 351-item delete list summary.

## 4. Reference-repo research (agent fan-out, 2026-07-30)

- **darkroomengineering/satus** — MIT, very active (push same-day). Production Next.js 16 + Tailwind v4 + GSAP/Lenis/R3F/Theatre.js starter. **Use:** blueprint for design-kit ingestion (its dependency-pruning/branding-removal handoff CLI ≈ our drag-drop kit normalizer); candidate emitted scaffold template for generated sites; known-good ingestion test fixture. Caution: heavy/opinionated — one template choice, not the only one.
- **codrops (org)** — ~345 one-off MIT demo repos (check per-repo assets; "Design Freebies" line is NOT MIT). **Use:** day-one seed corpus for the inspiration library (tagged demo URLs + live previews); a snippet pool the generator adapts (transitions, hovers, off-canvas); reference for what the URL/folder ingestion should extract per demo. Not a kit — needs component-wrapping before design-kit ingestion applies.
- **pmndrs/react-three-fiber** — MIT, very active (9.6.1, v10 canary). **Use:** on-demand 3D lane — generator emits r3f+drei scaffold when a brief calls for WebGL heroes/product viewers; `gltfjsx` at ingestion time converts dragged-in GLTF/GLB assets into typed reusable JSX components. Caution: never a default dependency (bundle weight).
- **AxiomeCG/awesome-threejs** — CC0 link list, not code. **Use:** one-time skim to bulk-seed the inspiration library's 3D/WebGL section; confirms r3f+drei+GSAP as the 3D toolchain for emitted scaffolds. Don't poll/sync it.
- **darkroomengineering/lenis** — MIT, ~958k weekly downloads, actively maintained. **Adopt:** default smooth-scroll layer in emitted premium-site scaffolds; auto-tag saved inspiration URLs with a detected "uses Lenis" signal; clean standing dependency for the reusable asset library. Caution: interacts with sticky/scroll-snap — per-project smoke test; don't blanket-insert into every scaffold. (Operator-level note: outside this repo, GSAP/Lenis usage is restricted to the `scroll-film-studio` lane; MishMash's own design authority governs in-repo.)

## 5. Rollback

Everything is on `feat/workflows-and-assets`; folders are git-tracked (restore via checkout of the parent commit), DB backup at `~/Inbox/misc/mishmash-od-backup-2026-07-30/` before any mutation (`.od-backup-*` inside the repo would not be gitignored), and `pruneRemovedBundledPlugins` re-registers anything whose folder is restored on the next boot.
