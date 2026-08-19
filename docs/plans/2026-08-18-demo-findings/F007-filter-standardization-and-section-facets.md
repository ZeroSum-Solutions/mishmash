# F007 — Standardize every filter control, and make sections (hero, footer…) filterable

| Field | Value |
|---|---|
| Captured | 2026-08-18, post-demo (screenshot) |
| Reported by | Devin |
| Type | **Design debt** + **missing facet** |
| Area | `packages/components` (new shared primitive) · `apps/web/src/styles/tokens.css` (tokens) · 20+ filter surfaces · design index (shared with F001) |
| Severity | **Medium-High** — the primary catalogue filter is 64% useless |
| Effort | **M** standardization · **S** section facet (rides F001's index, hard-blocked until it lands) |
| Status | 🔬 Scoped — **repaired 2026-08-18, several items marked DECISION REQUIRED (see §5); not fully unattended-safe until those are answered** |

---

## 1. Raw note (verbatim)

> I would also like beyyer filters on all the pages. i dont like the buble components that are
> shown now. please change them and standardize all the filters thoughout the web app please.
> No more buble button components. choose something that looks beter, or create like dropdown
> lists or something. also if there are heros, or footers or anytithe category i want to see
> those to please.

**Screenshot:** on Devin's Desktop, filename `Screenshot 2026-08-18 at 6.59.51 PM.png` when
typed normally — the real file uses U+202F (narrow no-break space) before `PM`, not a regular
space, so a literal-string open/copy of that path will fail. Match it with a glob instead:
`~/Desktop/Screenshot 2026-08-18 at 6.59.51*PM.png`. Content: the Templates page, 561 items,
two stacked rows of pill filters plus an `All / Yours / Built-in` segmented control.

**Two separate asks**, with very different costs:

| | Ask | Nature |
|---|---|---|
| **A** | Replace the bubble/pill filters; standardize filter controls app-wide | Design debt |
| **B** | Let me filter by hero, footer, "any other category" | Missing data facet |

---

## 2. Ask A — evidence

**There is no shared filter component. Every surface rolls its own.**

| Measure | Value | Command |
|---|---|---|
| Distinct `chip`/`pill` CSS classes in `apps/web/src/styles` (global stylesheets only) | **94** | `grep -rhoE "\.[a-z][a-z0-9-]*(chip\|pill)[a-z0-9-]*" apps/web/src/styles \| sort -u \| wc -l` |
| Additional `chip`/`pill` classes in colocated CSS Modules under `apps/web/src` (missed by the command above) | **27**, across **25** `.module.css` files | `grep -rhoE "\.[a-zA-Z_][a-zA-Z0-9_-]*(chip\|pill\|Chip\|Pill)[a-zA-Z0-9_-]*" apps/web/src --include="*.module.css" \| sort -u \| wc -l` |
| Combined honest baseline | **121** (94 + 27) | sum of the two commands above |

The original 94-only number is real but incomplete: it only sees the global stylesheet
directory. Component-owned styles that already migrated to CSS Modules (the pattern
`AGENTS.md` → "Web CSS ownership" prescribes) are invisible to it. **Every gate in §4.4/§4.5
below uses the combined command, not the narrow one**, so consolidating by relocating a
class into a CSS Module can't launder the count.

**Components implementing their own category/filter row.** Two independent repo-wide
searches (different keyword patterns, since there is no single naming convention — that's the
underlying problem) surfaced at least these; treat the union as a *floor*, not a ceiling:

`TemplatesSection`, `DesignBrowserPanel`, `DesignLibrarySection`, `DesignsTab`,
`DesignSystemsSection`, `DesignSystemsTab`, `ExamplesTab`, `SkillsSection`,
`PluginsHomeSection`, `RoutinesSection`, `MemorySection`, `SettingsDialog`,
`BrandReferencePicker`, `FileWorkspace`, `MessageCenter`, `PluginsView`, `TasksView`,
`MarketplaceView`, `LibrarySection`, `TypefacesSection`, `ConnectorsBrowser`,
`LibraryPicker`, `workspace/TabLauncherMenu`, `AssistantMessage`, `DesignFilesPanel`,
`NewProjectPanel`, `pet/PetSettings`, `QuestionForm`.

That is **27+ surfaces**, not "14+". Because no reliable enumeration command exists (naming
is inconsistent by construction — chip/pill/filter/category all appear, sometimes none of
them), **§4.4's acceptance criterion is a negative-match gate, not a headcount**: after
migration, a repo-wide search for the old per-surface selector patterns must return nothing
outside `packages/components` and the six named non-filter status indicators (below).

| Shared filter primitive | **none** — no `Filter*`, `Chip*`, `Pill*`, or `Segmented*` component exists |
|---|---|

So "standardize all the filters" is real architectural debt, not a repaint.

**Where the shared component belongs.** `AGENTS.md` → "Web component reuse" is explicit: *"If
a needed primitive is missing, prefer adding a small focused primitive to `packages/components`
with colocated CSS Modules... Keep product-specific layout and workflow styling in the app,
not in `packages/components`."* `packages/AGENTS.md` confirms `packages/components` is "shared
React UI primitives and primitive CSS." `apps/web/src/styles/primitives.css` is the *wrong*
home for a new shared React component — that global-stylesheet directory is for tokens,
resets, and legacy cross-component selectors that can't yet be scoped, not for a net-new
primitive. `packages/components` currently has only 4 CSS files, so this is a clean drop, not
a fight with existing structure. **This corrects the original PRD's R1, which pointed at
`primitives.css`.**

### ⚠️ Scope flag on "No more bubble button components"

Of the 94+27 classes, many are **not filters** — `status-pill`, `connector-status-pill`,
`plan-badge`, `context-chip-strip`, `staged-chip`, `memory-extraction-pill`. Those are
status/metadata indicators, where a pill is a defensible choice and the alternative is worse.

**Recommendation:** scope this finding to **filter controls**. Removing every pill-shaped
element in the app is a different, larger decision — flagged rather than assumed. Say if you
want the wider sweep and I'll file it separately.

### Design authority

`docs/design-authority.json` **DISCLAIMS** operator-global CLAUDE.md design guidance for this
repo, and **RETAINS** MishMash's native design systems. So the replacement control must derive
from **`tokens.css` and MishMash's own design system** — not from house defaults, not from my
preference. That constraint is binding on whoever implements this, and it is a machine-checked
claim (`scripts/check-context-isolation.test.ts` reads `docs/design-authority.json`), not just
prose — it does not need re-verification per PR.

### Why a dropdown is the right call here — a functional argument, not a taste one

The screenshot shows roughly 15 category pills across two wrapped rows, plus a segmented
control, plus search (exact live count depends on how many categories currently have ≥1
item and can drift — do not hardcode "15" into a test). Ask B adds a section facet with up to
14 more values (§3). A chip row does not survive that: it already wraps to two rows, and every
value costs horizontal space whether or not anyone uses it.

**Proposed shape:**

- One compact filter bar: `search` + `Category ▾` + `Section ▾` + `Source ▾` (All/Yours/Built-in)
- Counts stay — `Websites & Landing Pages (357)` inside the dropdown, which is where counts
  belong and where they cost nothing
- **Chips survive in exactly one role: showing what is currently active**, each removable, with
  a `Clear all`. That is the job pills are genuinely good at — reporting state, not offering
  every option at once.

---

## 3. Ask B — evidence, and why this is the more valuable half

**The primary filter puts most of the catalogue in one bucket.**

| Scope | Top bucket | Share |
|---|---|---|
| Live page (561 items) | Websites & Landing Pages — **357** | **64%** |
| `design-templates/` (**352** dirs with a `SKILL.md` at repo-scan time — re-measure with `find design-templates -mindepth 1 -maxdepth 1 -type d -exec test -e '{}/SKILL.md' \; -print \| wc -l`, don't hardcode) | `landing-page` — **183** | **52%** |

A filter whose first option holds two-thirds of the corpus is not a filter.

> Note: `design-templates/` has **353** top-level directories total; one (whichever currently
> lacks `SKILL.md`) doesn't count as a template. F001's own success criteria cite "all 353" —
> that's a stale number in F001, not something this finding can fix, but it means **F007 must
> not hardcode 352 or 353 anywhere it can instead read `design-templates/index.json`'s actual
> entry count once F001 R1 exists.**

**The section data he wants already exists in the slugs and prose — just not as a facet.**
Two different counting methods give very different answers, and the gap matters for R8 below:

**Method 1 — naive substring match** (what the original evidence table used:
`ls design-templates | grep -ci <word>`). This is what produced the original table, and it is
**unreliable**: `nav` matches `lexington-navy` (a site named "Navy", zero nav templates); `form`
matches `peoples-platform`, `performance-run-fitness`, `transform-data-hero`, and
`video-shortform` — none of which are forms. Only 1 of the 6 `form` substring hits
(`arceage-contact-form`) is real.

**Method 2 — token-boundary match** (split each slug on `-`, count exact tokens):
`ls design-templates | tr '-' '\n' | sort | uniq -c | grep -Ew "hero|grid|form|pricing|contact|cta|nav|testimonial|faq|about|team|blog|footer"`
(use `/bin/ls`, not an aliased `ls`, so directory names aren't reformatted with trailing
markers before the split):

| Section | Templates (token-exact) | | Section | Templates (token-exact) |
|---|---|---|---|---|
| **hero** | **52** | | contact | 2 |
| grid | **10** (not 12 — the earlier number came from substring matching, which over-counts) | | cta | 2 |
| form | **1** (not 6 — see above) | | nav | **0** (not 1 — `lexington-navy` was the only substring hit and it isn't a nav template) |
| pricing | 3 | | footer | 2 |
| testimonial | 1 (`arceage-testimonials`) | | faq / about / team / blog | 1 each |

**52 hero templates exist and there is no way to ask for them** — that number survives both
methods and is the strongest single fact in this finding. But **R8's claim that slug matching
is "highest confidence" is only true with token-boundary matching, not substring matching**;
the original PRD implied the latter. Fixed below.

**DECISION REQUIRED (blocks final R7 vocabulary):** `grid` (10 real templates) shows up in the
evidence but was never in the proposed controlled vocabulary in either the original R7 list or
Addendum A's facet table — an unexplained contradiction between what was measured and what was
specified. Either add `grid` as a ratified section value, or explicitly decide it's a layout
descriptor that doesn't belong in a page-anatomy facet (pricing grids, gallery grids, and
feature grids are semantically different things sharing one slug word) and drop it from the
evidence table. Whoever executes must not silently pick one — say which, in the PR description.

**323 of 352 SKILL.md files mention sections in prose** was the original claim; the actual
case-insensitive count is **324** (`grep -ril "section" design-templates/*/SKILL.md | wc -l`).
Off by one, not load-bearing, fixed for the record. More importantly — as the original PRD
already noted — mentioning the word "section" in prose does not identify *which* controlled
section values apply; source (2) below still needs a real extraction step, not just a
word-count.

> **This is the same root problem as F001.** The catalogue has rich content and a thin index.
> The section facet belongs in **F001 R1's `design-templates/index.json`**. **Do not build a
> second index.** (Field name — `sections[]` vs `section` — is pinned in §4.2/R7 below; it is a
> genuine cross-finding naming gap, not resolved by F001's current text.)

---

## 4. PRD

### 4.0 Preflight — run before touching any Rn below

This is not optional scaffolding; skipping it is how an unattended run produces a PR that
can't merge or duplicates work already scoped elsewhere.

- **P-1 · Clean, synced checkout.** At doc-repair time, `main` was `ahead 2, behind 1` of
  `origin/main`, with `apps/web/next-env.d.ts` modified and this findings directory untracked.
  Before starting: `git fetch`, resolve the divergence (rebase or merge per normal repo
  practice), and confirm `git status --porcelain` is clean on tracked source files before the
  first commit of this work. Work in its own branch/worktree — do not commit section-facet
  work on top of an unrelated dirty tree.
- **P-2 · F001 dependency gate.** `design-templates/index.json` and `scripts/build-design-index.ts`
  **do not exist yet** (`test -f design-templates/index.json`, `test -f scripts/build-design-index.ts`
  — both currently fail). §4.2 (P0-B, the section/theme/style facet work) is **hard-blocked** on
  F001 R1 + R2 landing first; §4.1 (P0-A, the filter-primitive standardization) is **not**
  blocked and can proceed independently — it only touches existing `category`/`scenario`
  fields the API already serves. **If F001 R1/R2 has not landed by the time this finding is
  picked up, execute §4.1 only tonight and stop; do not attempt to reimplement F001's index
  inside this finding.**
- **P-3 · `scripts/design-taxonomy.ts` already exists** (confirmed: 20-value `CATEGORIES` enum,
  `CATEGORY_LABELS`, `LEGACY_CATEGORY_MAP`). Every new vocabulary (`SECTIONS`, `STYLES`,
  `THEMES`, `SCENARIOS`, etc.) is an **extension of this file**, following its existing
  export/label/legacy-map pattern — not a new file, and not a duplicate taxonomy elsewhere.

### 4.1 P0-A — one filter primitive (Ask A) — independent of F001

- **R1 · Shared primitive, correct location.** A React component (plus colocated CSS Module)
  in `packages/components`, consuming tokens from `apps/web/src/styles/tokens.css`. Supports:
  search, single-select facet, multi-select facet, counts, active-filter summary, clear-all.
  (Was: "`primitives.css` + a matching React component" — wrong package per `AGENTS.md` → "Web
  component reuse"; fixed above.)
- **R2 · Migrate every surface in §2's list to it.** Acceptance is a negative-match grep, not a
  headcount (no reliable positive enumeration exists — see §2): after migration,
  `grep -rE "filter-pill|category-chip|chip-row|subtab-pill" apps/web/src/components --include="*.tsx"`
  and the CSS-class command from §2 must return matches **only** inside `packages/components`
  and the six named non-filter status classes (`status-pill`, `connector-status-pill`,
  `plan-badge`, `context-chip-strip`, `staged-chip`, `memory-extraction-pill`). Delete
  per-surface chip CSS as each surface lands.
- **R3 · Filter controls are dropdowns**, not chip rows. Chips remain only as removable
  active-filter indicators (§2).
- **R4 · Keep counts** — they are genuinely useful and appear in the dropdown.
- **R5 · Accessible, with a real oracle.** Keyboard-navigable (arrow/Home/End/Escape on the
  dropdown, focus restoration on close), labelled, focus-visible. **Correction:** the a11y jury
  panel (F006, `apps/daemon/src/prompts/panel.ts`) does **not** "score exactly this" — its fixed
  scored dimensions are `contrast`, `focus`, `headings`, `alt_text`; keyboard operability and
  label contract aren't scored fields there. Use the harness that actually exists instead:
  extend `e2e/ui/a11y-core-surfaces.test.ts` (already wired to `@axe-core/playwright` via
  `expectNoNewA11yViolations`) to cover every migrated filter surface, and add explicit keyboard
  assertions (`page.keyboard.press('Tab' | 'ArrowDown' | 'Escape')`) in the new Playwright test
  from R-verify below.
- **R6 · i18n** for all new strings; `pnpm i18n:check` (`scripts/i18n-check.ts`, confirmed to
  exist) green.
- **R2b · Dual-track n/a for R1–R6.** Nothing here is a new backend capability — it's a UI
  refactor of filtering that already exists per-surface against endpoints that already exist.
  No new `/api/*` route, contract type, or `od` subcommand is required by P0-A alone. (Dual-track
  requirements start at §4.2, where a genuinely new capability — filtering by section/theme/style
  — is added.)

### 4.2 P0-B — section facet (Ask B) — blocked on Preflight P-2

- **R7 · `sections: string[]` on the design index.** Extend **F001 R1's** `index.json`. Array
  field, plural, matching the `palette[]` / `mood[]` convention F001 R1 already establishes for
  multi-value fields (F001's own text never actually defines a literal field name for this — it
  only says "section" in prose once — so this is F007 pinning the name, not resolving a documented
  conflict; confirm it matches whatever F001 R1 actually ships before wiring the validator, since
  a landed F001 index is the source of truth if it differs). Controlled vocabulary in
  `scripts/design-taxonomy.ts` (extend, don't duplicate — see P-3): `hero`, `nav`, `footer`,
  `pricing`, `testimonial`, `faq`, `gallery`, `contact`, `cta`, `about`, `team`, `blog`,
  `features`, `form`, plus `grid` pending the §3 decision.
- **R8 · Derive from three sources, in confidence order — with real confidence, not assumed
  confidence:**
  1. **Slug match — token-boundary only**, never substring. `grep -ci` on the raw slug string is
     wrong (see §3: it false-positives `lexington-navy` as `nav` and 5 of 6 `form` hits are
     wrong). Split the slug on `-` and match whole tokens. Ship a fixture test asserting the
     known false positives from §3 (`lexington-navy`, `transform-data-hero`,
     `performance-run-fitness`, `html-ppt-zhangzara-peoples-platform`, `video-shortform`) do
     **not** match `nav` or `form`.
  2. `SKILL.md` prose (324 files mention "section" in some form — a weak signal on its own;
     needs actual value extraction, not a word-count).
  3. Parsing `example.html` for `<section>` landmarks and heading structure.
  - **Fallback required for source 3's gaps:** 8 of 352 templates have no top-level
    `example.html` at all, and 89 of the remaining 344 that do have no `<section>` element
    inside it (`grep -qi "<section" example.html`). These 97 templates need a defined fallback
    — either `sections: []` with `confidence: none` recorded, or fall through to sources 1–2
    only. Do not let the indexer crash or silently omit these templates from the index.
- **R9 · Gate it.** `scripts/validate-design-catalog.ts` rejects any `sections[]` value outside
  the vocabulary — same gate F001 R2 adds for `mood`. (Confirmed: the validator currently has no
  `scenario` check at all — see R16 — so "same gate as category" is the right model to copy,
  not an assumption that one already exists for every field.)
- **R10 · Surface it** as the `Section ▾` facet, combinable with Category.
- **R7-dual · Dual-track closure for the section facet (AGENTS.md "Capability exposure").**
  Filtering by section is a new user-facing capability and needs all four surfaces in the same
  PR:
  - **HTTP:** extend `GET /api/design-templates` (`apps/daemon/src/routes/static-resource.ts`)
    to accept an optional `?section=<value>[,<value>]` query param (comma-separated for R11's
    multi-select) and filter server-side; same shape for `?category=`.
  - **DTO:** add `sections?: string[]` to the shared response type used by `/api/design-templates`
    in `packages/contracts/src/api/registry.ts` (the type currently exposes `category` and
    `scenario` only — confirmed by reading the file).
  - **Web:** the `Section ▾` dropdown from R10.
  - **CLI:** `od design-templates` already exists and is registered in `SUBCOMMAND_MAP`
    (`apps/daemon/src/cli.ts:930`) with `list`/`show`/`preview` and `--json` — it is **not**
    net-new. Extend it: add a `--section <value>` flag (and `--category <value>`) to
    `LIBRARY_STRING_FLAGS`/`runDesignTemplates`, applied the same way the server-side query
    param is. Do not create a second `od` command for this.
- **R-scope · Runtime/derived templates are out of scope for tonight, explicitly.** The static
  `index.json` only covers repo-committed `design-templates/`. The live `/api/design-templates`
  endpoint also merges `USER_DESIGN_TEMPLATES_DIR` (runtime-owned, user-imported templates) and
  synthesizes "derived example" cards from `SKILL.md` neighbors (`apps/daemon/src/skills.ts`).
  Neither has a facet story. **DECISION REQUIRED (does not block P0-B, but must be stated in the
  PR):** either (a) user/derived templates simply don't appear when a `sections`/`style`/`theme`
  filter is active (documented, tested, not a crash), or (b) they get a real indexing path. Do
  not silently pick (b) without scoping it — it's materially more work (facet inheritance for
  derived cards, on-the-fly extraction for user uploads) and isn't in this finding's original
  ask.

### 4.3 P1

- **R11 · Multi-select facets** — "heroes OR footers".
- **R12 · Empty-state honesty, machine-checkable version.** When a facet combination returns
  zero results (real today: 1 nav template split across `grid`-decision-pending values, 2
  footers — some combinations legitimately return nothing), render a specific empty state
  (`data-testid="facet-empty-state"`) with a working "Clear this filter" control — assert both
  exist via Playwright/Testing Library. **Dropped from this finding:** the original "say what
  *is* nearby" language implies a similarity/ranking function with no defined distance metric or
  oracle — that's a real feature but not a testable P1 requirement as written; if wanted, it
  needs its own scoped finding with a defined ranking mechanism.

### 4.4 Success criteria

1. Every surface in §2's list uses the shared `packages/components` filter primitive. Verified
   by R2's negative-match grep returning zero unexpected hits (see §4.5).
2. **Combined chip/pill class count (94 global + 27 CSS-Module, §2's "combined honest baseline"
   of 121) drops** — measured by re-running both §2 commands post-migration and confirming their
   sum is lower than 121, not just the narrower 94.
3. No filter surface uses a wrapping chip row as its picker — verified by the Playwright test
   in §4.5 asserting each migrated surface exposes one `<select>` or ARIA-combobox control per
   facet, not N sibling pill buttons.
4. Filtering `Section = hero` returns **≥52** templates (verified against token-boundary
   counting, §3 — do not accept a substring-derived number here).
5. Every `sections[]` value is in the controlled vocabulary; `validate-design-catalog.ts` exits
   0.
6. Keyboard-only operation of every migrated filter works — verified by explicit
   Tab/Arrow/Escape assertions in the Playwright test, not by manual check.
7. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` exit 0, **plus** the package-scoped tests
   AGENTS.md → "Validation strategy" requires for touched packages:
   `pnpm --filter @open-design/web test`, `pnpm --filter @open-design/daemon test`,
   `pnpm --filter @open-design/contracts test` (contracts changes per R7-dual), and
   `pnpm --filter @open-design/components typecheck` if that package has one.

### 4.5 Verification

```bash
cd ~/projects/mishmash

# --- Preflight (§4.0) ---
git status --porcelain               # must be clean on tracked files before starting
test -f design-templates/index.json && test -f scripts/build-design-index.ts \
  && echo "F001 landed — P0-B may proceed" || echo "F001 NOT landed — P0-A only tonight"

# --- Ask A / P0-A (§4.1) ---
grep -rhoE "\.[a-z][a-z0-9-]*(chip|pill)[a-z0-9-]*" apps/web/src/styles | sort -u | wc -l
grep -rhoE "\.[a-zA-Z_][a-zA-Z0-9_-]*(chip|pill|Chip|Pill)[a-zA-Z0-9_-]*" apps/web/src --include="*.module.css" | sort -u | wc -l
# ^ sum these two; combined baseline was 121 at doc-repair time — confirm the post-migration
#   sum is lower, and that R2's negative-match grep below is empty outside the allowed paths.
grep -rE "filter-pill|category-chip|chip-row|subtab-pill" apps/web/src/components --include="*.tsx" \
  | grep -vE "status-pill|connector-status-pill|plan-badge|context-chip-strip|staged-chip|memory-extraction-pill"

# --- Ask B / P0-B (§4.2) — only if Preflight P-2 passed ---
node scripts/build-design-index.ts && node scripts/validate-design-catalog.ts

# --- Repo-wide gates (AGENTS.md "Validation strategy") ---
pnpm guard && pnpm typecheck && pnpm i18n:check
pnpm --filter @open-design/web test
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/contracts test

# --- UI test — flat file under e2e/ui/, NOT e2e/specs/ (that tree is Vitest) ---
# Create e2e/ui/filters.test.ts importing `test`/`expect` from '@/playwright/suite'
# (per AGENTS.md "Validation strategy" and e2e/AGENTS.md "Naming and tools"), then:
pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts ui/filters.test.ts
```

The original verify block's `pnpm --filter @open-design/e2e exec playwright test
specs/filters.spec.ts` **would not run**: `e2e/specs/` is the Vitest business-spec lane
(`*.spec.ts` there means something different), and `playwright.config.ts` sets
`testDir: './ui'`. Fixed above.

---

## 5. Open questions for Devin

1. **How wide is "no more bubble components"?** Filters only (my recommendation and this PRD's
   scope), or every pill-shaped element including status badges? The second is a much larger
   sweep.
2. ~~**Dropdowns confirmed?**~~ **ANSWERED 2026-08-18 — dropdowns confirmed.** See Addendum A.
3. **Does this apply beyond the web app?** The figma-plugin and Theater surfaces have their own
   controls; currently out of scope.
4. **DECISION REQUIRED (blocks final R7 vocabulary) — is `grid` a section value?** 10 real
   templates token-match it, but it was never in the proposed vocabulary, and "grid" plausibly
   means different things across templates (pricing grid, gallery grid, feature grid). See §3.
5. **DECISION REQUIRED (blocks Style facet, A.2) — who curates the ~25–30 style descriptors**
   out of 151 `design-systems/` entries (with `DESIGN.md`; **151, not 152** — `_schema` has no
   `DESIGN.md` and doesn't count), and against what criteria for "descriptor" vs. "brand
   imitation"? This is a genuine curatorial judgment call, not something a script can decide.
6. **DECISION REQUIRED (blocks Theme facet, A.2) — luminance thresholds and precedence.** What
   luminance cutoff separates `light`/`dark`, and what rule decides `warm-paper` or
   `high-contrast` versus a plain light/dark value when a palette could plausibly qualify for
   more than one? (A reusable relative-luminance/contrast-ratio implementation already exists —
   `apps/web/tests/styles/filter-pill.test.ts` — as a computation reference, but the actual
   cutoff values are undecided.)
7. **DECISION REQUIRED (blocks Mood/Density/Motion facets, A.2) — fixed vocabularies.** F001 R1
   references a "fixed list" for `mood` and three-point scales for `density`/`motion_level`, but
   no such list exists yet in `scripts/design-taxonomy.ts` (confirmed empty of these exports).
   Someone has to author the actual value lists and the measurement heuristic for
   density/motion — this finding surfaces the gap, it doesn't fill it.
8. **DECISION REQUIRED (blocks R16 fully) — `live` vs `live-artifacts`.** These may be
   semantically distinct, not a formatting duplicate: `ExamplesTab.tsx:105` hardcodes
   `skill.scenario === 'live'`, so merging the two would change existing filter behavior, not
   just tidy a typo. The other near-duplicates found (`operation`/`operations`, quoted vs.
   unquoted YAML values) look like mechanical casing/pluralization noise and can be normalized
   without this same risk — see R16.
9. **DECISION REQUIRED (blocks R15, deferred to P1/backlog for tonight) — advisor⇄filter
   interop.** As written, R15 has no DTO, no endpoint, no state-transfer format, and no
   acceptance scenario. It is not implementable as specified. It is **not required for P0
   completion** — see §4.2/§A.3 — and should get its own scoped follow-up once the shape is
   decided.
10. **Do zero-count facet values render as disabled, or as clickable-into-an-empty-state?** R14
    (below) requires every taxonomy value to surface with no component edit; existing tests
    (`TemplatesSection.test.tsx`, `DesignSystemsTab.test.tsx`) currently assert the *opposite* —
    that a zero-count category gets no chip at all. R14 supersedes that old behavior (Devin's
    Addendum A instruction is unambiguous about wanting every facet exposed), but the UX detail
    of disabled-vs-clickable is not specified and should be picked before touching those tests.

---

---

## Addendum A — 2026-08-18: one facet lens, two front doors

> *"dropdowns are good, go with that and these too should be filterable though a similar lense
> as what we are creating the search aggregator to do, want theme, section, style, ect"*

**Dropdowns: confirmed.** R3 stands.

The second half is the more important instruction, and it changes the architecture of both
findings:

> **F001's advisor and F007's filters are two front doors onto ONE facet vocabulary and ONE
> index.** Natural language on one side, direct manipulation on the other. They must never
> drift, because they are the same query expressed two ways.

### A.1 Why this matters more than it sounds

Measured across `design-templates/` (**352** dirs with `SKILL.md` — re-measure, don't
hardcode, per §3's note), **every existing facet is top-heavy**:

| Existing facet | Top value | Share |
|---|---|---|
| `od.category` | `landing-page` — 183 | **52%** |
| `od.scenario` | `marketing` — 260 | **74%** |
| Live catalogue (561) | Websites & Landing Pages — 357 | **64%** |

Every facet the catalogue currently ships collapses into one dominant bucket. **The
discriminating facets — theme, style, section — are precisely the ones that do not exist yet.**
That is the whole problem, stated in one table.

### A.2 The shared facet lens

One vocabulary. Built once in F001 R1's `index.json`. Gated once by
`validate-design-catalog.ts`. Consumed by the advisor *and* the dropdowns.

| Facet | Values | Derived from | Status |
|---|---|---|---|
| **Category** | the 20 in `design-taxonomy.ts` (confirmed: `CATEGORIES.length === 20`) | `od.category` | exists, gated |
| **Section** | `hero`, `nav`, `footer`, `pricing`, `testimonial`, `faq`, `gallery`, `contact`, `cta`, `about`, `team`, `blog`, `features`, `form` (+ `grid`, pending §5.4 decision) | token-boundary slug match → prose → `<section>` parse (F007 R8, corrected) | **new**, field name `sections[]` per R7 |
| **Style** | curated descriptor subset of `design-systems/` — `brutalism`, `glassmorphism`, `neumorphism`, `editorial`, `minimal`, `luxury`, `bento`, `flat`, `neon`, `paper`, `dithered`, `claymorphism`, `gradient`, `mono`, … | `design-systems/` + prose | **new — DECISION REQUIRED, §5.5** |
| **Theme** | `light`, `dark`, `warm-paper`, `high-contrast` | luminance of the `palette[]` entry with `role === 'background'` (not `palette.background` — `palette` is an array of `{hex, role}` per F001 R1, "background" is a role value, not a property name) | **new — DECISION REQUIRED, §5.6** |
| **Mood** | `editorial`, `warm`, `clinical`, `brutalist`, `playful`, … | prose extraction (F001 R1) | **new — DECISION REQUIRED, §5.7 (no fixed list exists yet)** |
| **Density** | `compact` · `balanced` · `airy` | measured — algorithm undefined | **new — DECISION REQUIRED, §5.7** |
| **Motion** | field name is **`motion_level`** (per F001 R1), not `motion`; three-point scale, values `none` · `subtle` · `expressive` proposed here | measured — algorithm undefined | **new — DECISION REQUIRED, §5.7** |
| **Scenario** | cleaned vocabulary | `od.scenario` | exists, **needs hygiene, R16** |

**On Style:** `design-systems/` holds **152 directories total, but only 151 carry a
`DESIGN.md`** (`_schema` is a schema directory, not a catalogue entry, and the runtime loader
skips anything without `DESIGN.md`). Of those 151, they are two different things — brand
imitations (`apple`, `nike`, `ferrari`, `notion`) and genuine style descriptors (`brutalism`,
`editorial`, `luxury`, `glassmorphism`, `minimal`). **Only the descriptor subset becomes the
Style vocabulary.** 151 values in a dropdown would recreate the problem this finding exists to
solve. Curating to roughly 25–30 is proposed, not decided — see §5.5.

**On Theme:** F001 R1 already extracts `palette[]` with role-labeled hex values (the role
vocabulary is `background` / `text` / `muted` / `rule` / `accent`, per F001's own later
tightening — not the provisional `ink`/`surface`/`accent`/`tint` from its earlier draft). Reading
the `background`-role hex and computing luminance is nearly free once the index exists; the
open question is the numeric threshold and precedence rule (§5.6), not the mechanism.

### A.3 New requirements

- **R13 · One vocabulary, one home.** All facet vocabularies live in
  `scripts/design-taxonomy.ts` (extend the existing file — confirmed present, see §4.0/P-3) and
  are enforced by `validate-design-catalog.ts`. **A facet the filters expose but the advisor
  cannot rank on — or vice versa — is a defect**, not a difference in scope.
- **R14 · Facet dropdowns are generated from the vocabulary**, not hand-listed per page. Adding
  a value to the taxonomy must surface it in the UI with no component edit. **This directly
  supersedes existing test behavior** in `TemplatesSection.test.tsx` (asserts a zero-count
  category gets no chip) and `DesignSystemsTab.test.tsx` — those tests must be updated as part
  of this requirement, not left to silently conflict. See §5.10 for the one UX detail (disabled
  vs. clickable) still undecided.
- **R15 · Advisor ⇄ filter interop — DECISION REQUIRED, deferred out of P0 (§5.9).** Not
  implementable as specified: no DTO, no endpoint, no acceptance scenario. The intent (an
  advisor answer becomes adjustable filter state, and filter state becomes an advisor brief) is
  the eventual payoff of the shared lens, but needs its own spec pass before it's buildable.
  **Tonight's unattended run should not attempt R15.**
- **R16 · `od.scenario` hygiene pass.** Actual live values and counts
  (`grep -h "^  scenario:" design-templates/*/SKILL.md | sort | uniq -c`): 249× quoted
  `"marketing"` + 11× unquoted `marketing` (=260, matching A.1's table), plus near-duplicate
  clusters `operation` (2) / `operations` (2 unquoted + 3 quoted = 5), and `live` (1) /
  `live-artifacts` (1). The `operation`/`operations` and quote-style noise is mechanical
  casing/pluralization cleanup — fold it via a `LEGACY_SCENARIO_MAP` in `design-taxonomy.ts`
  mirroring the existing `LEGACY_CATEGORY_MAP` pattern. **`live` vs. `live-artifacts` is not
  mechanical** — see §5.8 — because `ExamplesTab.tsx:105` hardcodes
  `skill.scenario === 'live'`, so a merge changes existing filter behavior and needs an explicit
  call plus a code update in that file, not just an index/validator change.

### A.4 Added success criteria

8. Every facet in §A.2 that has a ratified vocabulary (Category, Section, Scenario — Style,
   Theme, Mood, Density, Motion pending their §5 decisions) is filterable in the UI **and**
   rankable by the advisor — verified by a test that enumerates `design-taxonomy.ts` and asserts
   the contract DTO, the CLI flags, and the UI dropdown options all include every value.
9. Adding a value to `design-taxonomy.ts` surfaces it in the dropdowns with no component change
   — verified by a test that adds a throwaway vocabulary value and asserts it renders.
10. Every indexed template has exactly one `Theme` value assigned once Theme ships (no template
    falls outside `light`/`dark`/`warm-paper`/`high-contrast`) — verified by
    `validate-design-catalog.ts` treating a missing/unrecognized Theme as a violation, the same
    pattern it already uses for `category`. (Replaces the original "non-trivial set" language,
    which had no defined minimum and wasn't falsifiable.)
11. `od.scenario`'s mechanical near-duplicates (casing, pluralization, quote-style) are gone and
    the field is validator-gated, per R16. The `live`/`live-artifacts` question is tracked
    separately (§5.8) and does not block this criterion.

---

## Revisions

- 2026-08-18 — captured post-demo. Chip-class count, filter-surface inventory, category
  distribution, and section-slug counts all measured against the repo the same session.
- 2026-08-18 — **Addendum A**: dropdowns confirmed; facet lens unified with F001's advisor.
  One vocabulary, one index, two front doors. Added theme/style/mood/density/motion facets
  and the scenario hygiene pass.
- 2026-08-18 — **Repair pass**, against `docs/plans/2026-08-18-demo-findings/audits/F007-audit.md`.
  Verified essentially every audited claim directly against the repo (commands shown inline);
  the audit's factual findings all checked out. Applied: fixed screenshot filename (U+202F),
  corrected the 94→121 chip/pill baseline to include CSS Modules, replaced substring-based
  section-slug counts with token-boundary counts (`nav` 1→0, `form` 6→1, `grid` 12→10) and
  flagged the false positives that caused the error, fixed `design-systems/` 152→151 (excludes
  `_schema`), fixed "323"→"324" SKILL.md mentions, moved the shared filter primitive from
  `apps/web/src/styles/primitives.css` to `packages/components` per `AGENTS.md` → "Web
  component reuse", corrected the mischaracterized F006 a11y-panel claim and pointed R5 at the
  real `@axe-core/playwright` harness instead, fixed the Playwright verify command from
  `e2e/specs/filters.spec.ts` (Vitest lane, would not run) to `e2e/ui/filters.test.ts`, added
  explicit dual-track (HTTP/DTO/CLI) requirements for the new section facet since `od
  design-templates` already exists and only needs new flags, added a Preflight section covering
  the unsynced/dirty checkout and F001's not-yet-landed index as a hard P0-B blocker while
  scoping P0-A to proceed independently, fixed `palette.background` → the correct
  `palette[].role === 'background'` shape, fixed the `motion`/`motion_level` field-name
  mismatch with F001, added the missing package-scoped test commands
  (`AGENTS.md` → "Validation strategy"), flagged the R14/existing-test conflict explicitly by
  file, and marked six genuinely-undecided items as **DECISION REQUIRED** in §5 instead of
  guessing an answer (Style curation, Theme luminance thresholds, Mood/Density/Motion
  vocabularies, the `grid` section-vocabulary question, `live`/`live-artifacts` scenario
  semantics, and R15's entire interop design) — R15 is explicitly moved out of tonight's P0
  scope rather than left half-specified inside it.
