# Design Library Standardization

**Status:** Approved (Devin, 2026-08-09, via /goal directive — "do your best work possible and do not stop for anything")
**Scope:** MishMash web Studio — Templates tab, Design Library tab, Design Systems tab, and the catalogs that feed them.
**Repos:** `~/projects/mishmash` (product, feature branch), `~/projects/mishmash-assets` (catalog + thumbs, local-only assets).

## Problem

The design-library experience is inconsistent and under-curated:

- Card system drifts across the three gallery surfaces: content-driven heights, mid-sentence content crops (e.g. `email-marketing`), two coexisting card templates without a clear rule.
- Covers do not represent contents: contact-sheet-style or arbitrary thumbnails; at least one template (`Example Bluehouse`) ships a literal `[property photo]` placeholder as its hero.
- Categories are weak: templates carry a loose taxonomy (DECK / PROTOTYPE / AUDIO visible in UI); `eng-runbook` (an ops dashboard) and `digital-eguide` (an editorial guide) are filed as PROTOTYPE; a DeFi dashboard item (yRise Finance) surfaces without visible name/category. Library categories are free strings equal to folder names.
- Descriptions are missing or thin for many items.
- Detail view is a minimal preview dialog; no hero-led detail experience, no browsable section previews.
- UI kits/design systems have no interactive reconstructed preview.
- Create-from-template is single-click; no guided brief (screens, fidelity, iterations, pages, product/audience, brand direction).
- Possible duplicate entries in the catalog (schema has `duplicate_of` but coverage unknown).

## Constraints

1. **Rights (binding, from `mishmash-assets/RIGHTS.md`):** UI8/NeuForm material is `licensed-source-review` — adapt locally, never commit to git, never re-host, never ship off-machine. Mobbin/land-book captures are `human-local-only`. All generated covers/reconstructions derived from licensed kits live under `~/projects/mishmash-assets/.catalog/` only.
2. **No deletions of asset files.** Duplicates are marked `duplicate_of` in catalog.json and suppressed in UI, never deleted from disk.
3. Product changes land on a feature branch in `~/projects/mishmash`; `pnpm typecheck` and `pnpm guard` stay green; existing test suites keep passing.
4. Client-owned identity rules do not apply — MishMash is Devin's own product; its existing visual language (dark glass, per-category accents) is the identity to refine, not replace.

## Success Criteria

Each criterion has a deterministic verification command run from `~/projects/mishmash` unless noted. Proofs are captured to `~/.claude/goal-state/design-library-standardization/proof/`.

- **C1 — Canonical taxonomy + validator exists.** `node scripts/validate-design-catalog.mjs` exits 0. The validator enforces: every `design-templates/*/SKILL.md` has `od.category` from the canonical enum and a non-empty description; every `catalog.json` item has non-empty `category` and `description`; every item has a cover (`thumb` non-null and file exists) or an explicit `cover_policy` exemption; no two items share a content hash unless one carries `duplicate_of`.
- **C2 — Miscategorized templates fixed.** `node scripts/validate-design-catalog.mjs --report-categories eng-runbook digital-eguide` shows corrected categories (eng-runbook → dashboard; digital-eguide → document/guide class; the yRise dashboard item categorized as dashboard), exit 0.
- **C3 — No placeholder heroes.** `grep -rInE '\[(property photo|photo|image|img|placeholder)[^]]*\]' design-templates/*/example.html` returns no matches (exit 1 from grep). Bluehouse renders a real visual in place of the placeholder.
- **C4 — Card system standardized.** New/updated component tests asserting the card contract (fixed cover ratio, clamped title/description lines, uniform metadata row, consistent action placement) pass: `pnpm --filter @open-design/web test` exit 0. A gallery screenshot is captured as visual evidence.
- **C5 — Accurate covers per item type.** Validator cover checks pass (part of C1 run) after regeneration: kits show purposeful kit reconstructions, dashboards show dashboards, landing pages show landing pages, mobile templates show a primary mobile screen, icon sets show icon grids, WebGL/effects show the asset. Regeneration script output captured.
- **C6 — Detail view upgraded.** Component tests assert detail dialog renders hero image, title, description, and a browsable preview strip (next/prev navigation): `pnpm --filter @open-design/web test` exit 0.
- **C7 — Interactive kit canvas.** For UI kit / design-system items with permitted rights tiers, the detail view offers an interactive reconstructed preview (scrollable live canvas via daemon live-preview/entry_html). Daemon + web tests covering the flow pass: `pnpm --filter @open-design/daemon test` and web test exit 0.
- **C8 — Guided create flow.** Choosing "Use as template" (library) or creating from a template opens a guided brief flow collecting: screen count, fidelity level, iteration count, required pages/flows, product/audience/use case, brand/content/visual direction. The brief feeds the generation prompt. Component + daemon tests pass, exit 0.
- **C9 — Duplicates resolved.** Validator duplicate check passes: no unmarked content-hash duplicates in catalog.json (part of C1 run; duplicate report captured).
- **C10 — Build green.** `pnpm typecheck` exit 0 AND `pnpm guard` exit 0 on the feature branch.

## Amendment 1 (Devin, 2026-08-09, mid-run directive)

Added scope, same run:

- **C11 — Images always load.** Every image surface (library cards, template cards, detail views, storyboard shot cards) is guaranteed to render a visual: broken/missing sources fall back to a styled, deterministic placeholder state (never a browser broken-image glyph), and catalog thumbs are verified on disk. Component tests cover the fallback path: `pnpm --filter @open-design/web test` exit 0.
- **C12 — Templates tab restructure.** Websites/landing sites lead: `landing-page` (websites, landing sites) is the top section of the Templates tab. Web apps are a separate, filterable category (`web-app`, added to the canonical enum) alongside `dashboard` — separated and filterable like dashboards. All remaining categories follow, structured. Verified by component tests asserting section order + category filters.
- **C13 — Hardened animated scroll-hero.** A scroll-film hero design-template family built per the `scroll-film-studio` skill (Lane A: GSAP/Lenis pure-code motion, self-contained — no CDN dependencies at render time). Hardened and tested under multiple scenarios: prefers-reduced-motion, small/mobile viewport, JS disabled (graceful static fallback), missing/slow assets, resize mid-scroll. Scenario checks captured as proof.
- **C14 — Storyboard page mimics the Higgsfield flow.** The StoryboardEditor flow aligns with Higgsfield's film-creation UX (scenes → per-shot start frame + prompt + style/engine → generate → assemble), engine-agnostic with Higgsfield as the reference implementation, so moving between MishMash and Higgsfield feels like one workflow. Verified by component tests on the flow steps.
- **C15 — Pipeline proof projects.** 3–4 genuinely different scrollable-hero storyboard projects created through the pipeline (distinct concepts and art directions), stored locally, each verified to load and scroll-scrub. Existence + smoke checks captured as proof.

New tasks t11–t15 map to C11–C15; t10 (final gate) remains last and now covers the amended criteria too.

## Out of Scope

- The `.dc.html` mockups in `~/projects/mishmash-design-redesign` (separate exploration; untouched).
- Deleting or re-organizing asset files on disk in `mishmash-assets`.
- Upstream Open Design surfaces unrelated to the three gallery tabs.
- Publishing/deploying anything off-machine.

## Notes

- Canonical template taxonomy (enum, final spelling decided in t1): `deck`, `landing-page`, `dashboard`, `mobile-app`, `docs`, `document-guide`, `email`, `prototype`, `audio`, `video-motion`, `webgl`, `icons`, `effect`, `component`.
- Library (catalog.json) keeps its group folders but every item gains a normalized `category` from the same enum family plus a curated description.
- Cover generation for licensed material writes only to `mishmash-assets/.catalog/` (gitignored territory, local-only).
