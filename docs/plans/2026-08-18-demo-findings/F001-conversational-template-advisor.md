# F001 — Conversational template advisor with visual multi-select → project start

| Field | Value |
|---|---|
| Captured | 2026-08-18, live team demo |
| Reported by | Devin |
| Area | Home chat composer · design library retrieval · GenUI surfaces · project scaffold |
| Severity | **High** — this is the main-page first-run path the demo opens on |
| Effort | **L**, phased P0 / P1 / P2 |
| Status | 📝 Captured → 🔬 Scoped → 🛠 Repaired 2026-08-18 (see §6 for what is and isn't unattended-ready) |

---

## 1. Raw note (verbatim)

> in the chat box on the main page, i want to ask things like, "hey, can you please tell
> me the best templates to use for a small business poetry website? please let me know
> colors and fonts too.". -what i would like to see from this is all the viable options
> that would suit this query. It should know what a potery site needs, colors, styles, ect
> and also i think we should link the Refero MCP `[endpoint + bearer token redacted →
> ZS Vault id: refero_mcp_token, env REFERO_MCP_TOKEN]`. that might be good for the serch
> portion too. but I want this to basically sellect the top pics and i want to see all of
> them visually and be able to select the ones im interested in and start a project with
> those selected.

**Restated as an acceptance scenario:** a user types one plain-English design question
into the home chat box and gets back a *visual, ranked, selectable* set of real options
from the library — each explaining its palette and type choices — then converts the
selection into a started project without retyping the brief.

---

## 2. Current state (verified against code, re-measured 2026-08-18)

| Concern | Where it lives today | State |
|---|---|---|
| Home chat entry | `apps/web/src/components/ChatComposer.tsx`, `HomeHero.tsx`, `HomeView.tsx` | Free-text composer exists |
| Template library | `design-templates/` — **352 templates** (every dir with a `SKILL.md`; `find design-templates -mindepth 1 -maxdepth 2 -name SKILL.md \| wc -l`). `ls design-templates \| wc -l` returns 353 because that also counts `design-templates/AGENTS.md`, which is not a template — this is the source of the earlier "353" miscount. | Rich, current |
| Design systems | `design-systems/` (per-system dirs, `_schema/`) | Rich, current |
| Per-template metadata | `SKILL.md` frontmatter (**352/352**, mandatory) + `template.json` (**281/352**, vendored-entry provenance only per `design-templates/AGENTS.md:28-35,39-44` — not universal, do not treat as "the" metadata file) | Partial — see gaps |
| Catalog enforcement | `scripts/validate-design-catalog.ts` vs `scripts/design-taxonomy.ts` (**20** `CATEGORIES` entries, counted from the file itself) | Working gate |
| **Existing brief→catalog matcher (F001 must extend this, not replace it)** | `packages/contracts/src/api/catalogue-match.ts` (`matchCatalogue`, pure/deterministic trigger + description-overlap scoring) → `POST /api/catalogue/match` (`apps/daemon/src/routes/catalogue-match.ts`) → `apps/web/src/components/CatalogueMatchSuggestions.tsx` (home composer, debounced) → `od catalogue match --prompt/--prompt-file --json` (`apps/daemon/src/cli.ts:1867-1990`, already in `SUBCOMMAND_MAP`) | **Fully dual-track already: HTTP + contract + web UI + CLI.** This is the real "current state" for retrieval — the original draft of this finding did not know it existed and proposed a parallel system instead. |
| Browse UI | `apps/web/src/components/DesignBrowserPanel.tsx` | Exists |
| Agent → interactive UI | `apps/daemon/src/genui/{registry,store,events}.ts`; kinds `form \| choice \| confirmation \| oauth-prompt` (zod enum, `packages/contracts/src/plugins/manifest.ts:91`) | Exists, SQLite-backed request/respond round-trip — **but see §3 G3 for how it's actually invoked today**, which changes what R7 can assume |
| Refero | Outbound bookmark only — `DesignBrowserPanel.tsx:490` links `https://styles.refero.design/`; also cited as lint provenance in `apps/daemon/src/lint-artifact.ts:78` (Refero named as the source of the AI-slop-indigo flag) | **No API client** |
| NL → structured IR "precedent" — **does not exist as a usable pattern** | `evals/selector/nl-to-ir/` has only `goldens.json` and `parser.ts`. The parser is an explicit, deliberate **unimplemented stub that always throws** (`evals/selector/nl-to-ir/parser.ts:1-18,77-86` — its own header says implementing it is "out of scope for this wave"). A real `scorer/` and `floors.json` do exist, but one level up at `evals/selector/scorer/` and `evals/selector/floors.json` — they score **DOM composition fidelity** (`layout_geometry`, `palette_fidelity`, `motion_timing`, …) for a website-cloning eval, an unrelated domain. Neither piece is reusable for "turn this English sentence into a brief." | Cited in the original draft as a pattern to copy; it isn't one. |

What a template actually carries today. Two real examples, chosen because they show the
range — the earlier draft's example (`almond-hours-h65`) is **not** representative of "no
structured palette," it's one of the better-documented ones:

```jsonc
// design-templates/almond-hours-h65/template.json
{ "slug", "name", "family", "kind",
  "cdn_fonts": ["Jakarta", "Inter", "InterTight", "Instrument"],  // families only, no roles
  "vendored_from", "source", "source_license" }
```

```
# design-templates/almond-hours-h65/SKILL.md — this one DOES have a role-labeled,
# exact-hex palette and a role-labeled type system, but as a Markdown "build spec"
# section in the file BODY, not as machine-readable data:

## COLOR PALETTE (EXACT)
- INK / BRAND PRIMARY: `#1B1B1B` ...
- PAPER / BACKGROUND: `#FFFFFF`
- CREAM / BRAND SECONDARY: `#FFFBF0` ...
(8 roled entries total)

## TYPOGRAPHY
- DISPLAY / HEADINGS: PLUS JAKARTA SANS (700/800) ...
- BODY: INTER (300/400/500) ...
- NAV / LABELS / EYEBROWS: INTER TIGHT ...
```

Coverage of that pattern is **uneven across the catalog**, measured 2026-08-18 by scanning
every `SKILL.md`/`template.json`:

| Measure | Command | Result |
|---|---|---|
| SKILL.md files with ≥3 distinct 6-digit hex codes anywhere in the file | ad hoc regex scan, see §4.4 R1 | **190 / 352 (54%)** |
| `template.json` files with ≥2 `cdn_fonts` entries | ad hoc JSON scan, see §4.4 R1 | **84 / 281 (24% of all templates)** |
| Templates with root `example.html` | `find design-templates -mindepth 2 -maxdepth 2 -name example.html \| wc -l` | **344 / 352** |
| Templates with a root thumbnail file | `find design-templates -mindepth 2 -maxdepth 2 -iname '*thumb*' \| wc -l` | **0** |

This directly affects R1's success criterion — see §4.6 item 2 and the **DECISION
REQUIRED** flag there. These are today's numbers, not a permanent fact; re-run the
commands before trusting them again, per the repo's own no-stale-count rule.

---

## 3. The gap

Five distinct gaps sit between today and the raw note. **G1 and G2 are corrected below —
the original draft overstated both** (the matcher isn't silent, and the SKILL.md palette
isn't undiscoverable prose-only) — but the underlying problems they point at are real.

**G1 — Retrieval is lexical and shallow, not silent and not conceptual.**
The existing matcher (`matchCatalogue`, see §2) does **not** return nothing for the demo
query. Run against the live catalog, `"hey, can you please tell me the best templates to
use for a small business poetry website? please let me know colors and fonts too."`
matches `helix-strata-h76` — an enterprise B2B consultancy landing page — purely because
its `triggers` array contains the generic word `"business"`
(`design-templates/helix-strata-h76/SKILL.md:3-14`). That is the real failure mode: the
matcher can return a confident-looking but *domain-wrong* single result instead of
correctly reasoning "this is a poetry/literary brief, here are the dozen templates whose
type-led, low-chrome, editorial character actually fits." Nothing in the pipeline knows
what a poetry site needs. **This finding must extend `matchCatalogue`'s pipeline (or sit
downstream of it) — not stand up a second, parallel matching endpoint**, per repo rule
(AGENTS.md "Capability exposure") and to avoid two systems giving the home composer
contradictory suggestions for the same keystroke.

**G2 — Colour and type are inconsistently structured, not entirely unstructured.**
Some templates (like `almond-hours-h65` above) carry an exact, role-labeled palette and
type system as a Markdown section in the SKILL.md body. Many others don't — the 54%/24%
coverage numbers in §2 are the honest state. None of it is machine-readable *data* today:
it's Markdown a human reads, not a field a ranking function or a UI can query. The user's
literal ask — *"let me know colors and fonts too"* — cannot be answered from structured
data at all today. Any answer today would be an LLM re-reading source files per request:
slow, unrankable, non-deterministic, and untestable.

**G3 — No visual multi-select surface, and no confirmed invocation path for one.**
GenUI's `choice` kind is the nearest primitive, but it has no card/gallery variant, no
thumbnail, and no multi-select — that part of the original finding stands. What needs
correcting: GenUI surfaces are requested through `requestSurface`/`requestOrReuseSurface`
(`apps/daemon/src/genui/registry.ts`), and **every production caller of that path today is
the plugin-pipeline system** (`apps/daemon/src/plugins/*`, e.g.
`plugins/atoms/diff-review-genui-bridge.ts`) — every request carries a real
`pluginSnapshotId`. There is no existing precedent for a chat-agent tool call (outside the
plugin pipeline) requesting a GenUI surface directly. `apps/daemon/src/tools/connectors.ts`
— which the original draft cited as the place to register `design.advise_templates`
"alongside" — is not a general daemon-tool registry; it only lists/executes connected
third-party connector tools (`connectors.ts:64-137`). **This is a real open architecture
question, not a wiring detail — see the DECISION REQUIRED flag on R6/R7 in §4.4.**

**G4 — No selection → project handoff, and the existing schema is single-select.**
`CreateProjectRequest` (`packages/contracts/src/api/projects.ts:307-332`) and
`ProjectMetadata` (`:99-128`) carry exactly one `skillId` and one `templateId`. There is no
field for "N templates blended by section, with provenance." Converting a chosen set into
a started project needs a genuine, backward-compatible schema extension, not just new
glue code.

**G5 — No external inspiration source.**
Refero is a bookmark, not a capability (confirmed, §2). The library is 352 strong but
finite; a query with no good local answer currently degrades to a bad local answer instead
of reaching outward.

---

## 4. PRD

### 4.1 Problem

A user with a real brief and no design vocabulary cannot get from *question* to *started
project* in the product's primary entry point. They must already know what to browse for.

### 4.2 Goals

- **G-1** One plain-English question returns a ranked, visual set of real library options.
- **G-2** Every result states its palette and type pairing as *data*, not prose.
- **G-3** The system reasons about the *domain* asked for, not just keywords in it.
- **G-4** The user multi-selects visually and starts a project carrying brief + selections.
- **G-5** External references (Refero) supplement — never impersonate — buildable templates.

### 4.3 Non-goals

- Not a general web search feature.
- Not generating new templates on demand (that path already exists elsewhere).
- Not replacing `DesignBrowserPanel` or the existing `/api/catalogue/match` matcher — the
  advisor **extends** the same retrieval substrate, both must resolve to the same slugs,
  and the home composer must not end up running two independent brief-matching systems
  side by side.

### 4.4 Requirements

#### P0 — the demo path, end to end (see §4.6 for exactly which parts are unattended-ready tonight and which are gated on a decision)

- **R1 · Structured design index.** Generate `design-templates/index.json` from existing
  sources at build time via a new `scripts/build-design-index.ts` (does not exist yet —
  confirmed by `ls scripts/build-design-index.ts` failing). Per template:
  - `slug`, `name`, `category`, `scenario`, `family`, `tags`
  - `palette[]` — hex values extracted from the SKILL.md body (both the frontmatter
    `description` and any `## COLOR PALETTE` / build-spec section — see the
    `almond-hours-h65` example in §2), each with a role from the **fixed vocabulary**
    `background | text | muted | rule | accent` (per Addendum A.2 — this is now the only
    vocabulary; there is no separate provisional list to reconcile) and the sentence/line
    it came from as provenance.
  - `typography` — `{ body, body_alt?, headings, ui }` (fixed role vocabulary, Addendum
    A.2) resolved from `cdn_fonts` + the SKILL.md body, each with family name and a
    `confidence` field.
  - `mood[]` — controlled adjective vocabulary (e.g. `editorial`, `warm`, `clinical`,
    `brutalist`, `playful`). **This vocabulary does not exist yet** — add it as a new
    `MOODS` export in `scripts/design-taxonomy.ts` (today that file exports only
    `CATEGORIES`/`CATEGORY_LABELS`/`LEGACY_CATEGORY_MAP` — confirmed by reading it in
    full). Do not describe it as "drawn from a fixed list" as though the list already
    existed.
  - `density`, `motion_level` — three-point scales.
  - `preview` — path to `example.html` when present (344/352 templates — see §2) and a
    `hasExampleHtml: boolean` flag for the other 8, plus a `thumbnail: null` field until
    thumbnail generation (§4.4 "Missing work" below) exists. Do not claim every row has a
    preview; make the absence a typed, checkable field instead.
  - **Extraction is best-effort and must record `confidence` (`high | medium | low`).** A
    low-confidence field is marked, never silently guessed or hidden.
- **R2 · Index is gated.** `scripts/validate-design-catalog.ts` gains an index check:
  every template appears, every `mood` is in the controlled vocabulary, every palette hex
  is a valid 6-digit hex. **Also add a source-freshness check**: store a hash of the
  `SKILL.md` + `template.json` bytes each index row was built from, and fail validation if
  a template's current source hash no longer matches its index row's stored hash (i.e. the
  index is stale relative to source — this closes the "index silently rots" gap the
  original draft didn't cover). Wired into `pnpm guard`.
- **R3 · Domain knowledge layer — P0 scope is the `poetry` archetype only.**
  `apps/daemon/src/design/site-archetypes.ts` defining an `Archetype` schema (required
  sections, reading-comfort constraints, type character, palette temperament, motion
  ceiling, disqualifiers) plus the **fully specified `poetry`/literary archetype from
  Addendum A.3** — that content is real, checked-in, ready to implement as written.
  **Expanding to "at least 8 more small-business types" is explicitly NOT P0.** Each
  additional archetype needs the same kind of considered content Addendum A.3 has for
  poetry (real palettes, real typesetting constraints, real disqualifiers) — that is
  design judgment, not something to fabricate unattended overnight just to hit a round
  number. Move it to P2 as its own, separately-scoped item with its own review. Sourced
  from the repo's existing design authority, not invented — check `AGENTS.md` §Design
  authority and `docs/design-authority.json` first (both retained: MishMash's own
  `design-systems/` is retained design truth; operator-level design doctrine is
  disclaimed and out of scope here), and extend rather than contradict.
- **R4 · Brief extraction — reuses the proven deterministic matcher pattern, not the
  nonexistent NL→IR one.** NL query → structured brief
  `{ archetype, category, audience, tone[], must_have[], constraints }`. Build this the
  same way `matchCatalogue` already works (`packages/contracts/src/api/catalogue-match.ts`
  — tokenize, normalize, word-boundary-safe trigger overlap, deterministic, zero
  dependencies, already tested): map the query's tokens against each archetype's own
  trigger/keyword list (extend `Archetype` with a `triggers: string[]` field mirroring
  `CatalogueMatchCandidate`). This is the real, already-proven-in-this-repo pattern to
  copy — `evals/selector/nl-to-ir/` (§2) is not. For P0 (poetry-only archetype set, R3),
  "accuracy" is a single fixed test: the literal demo query and at least 2 paraphrases of
  it must resolve to `archetype: 'poetry'`. A full goldens/scorer/floors harness across
  many archetypes is P2 work, scoped together with R3's archetype expansion.
- **R5 · Ranking.** Brief × index → ranked candidates with a **per-result rationale
  naming the specific matched fields**. Deterministic and unit-testable given a fixed
  index. Must return ≥6 candidates for the demo query — verify this by actually running
  the built ranker against the built index once R1/R3/R4 exist, not by assertion.
  Addendum A.3's typesetting constraints (body measure, poem alignment, line-break
  handling) are **scored ranking inputs, not prose advice** — a template whose body
  measure runs 80ch or that centers long text blocks must score down for the poetry
  archetype even if its palette is perfect.
- **R6 · Advisor exposed as a first-class HTTP + CLI capability, independent of the chat-
  invocation question.** New contract `packages/contracts/src/api/design-advisor.ts`
  (request: brief text or pre-extracted brief; response: ranked candidates with
  rationale), new route `apps/daemon/src/routes/design-advisor.ts` mounting
  `POST /api/design-advisor/recommend`, and `od design-advisor recommend --prompt
  "<brief>" | --prompt-file <path|-> [--json]` registered in `SUBCOMMAND_MAP`
  (`apps/daemon/src/cli.ts:899`) — mirroring `od catalogue match`'s existing flag shape
  exactly. **This closure (HTTP + contract + CLI) is buildable and independently testable
  tonight without resolving G3/R7's chat-invocation question**, because it doesn't need
  GenUI at all — it's a plain request/response endpoint, same shape as
  `catalogue-match.ts`. The still-open question is *how the chat agent triggers it
  mid-conversation and gets a `gallery-select` surface back* — see R7.
- **R7 · Visual multi-select surface.**
  - **R7a** — `gallery-select` presents **named directions**, not just template cards.
    Each direction carries a name, a one-line character description, *what it's good
    for*, and *when not to pick it*. Templates sit under the direction that matches them.
  - **R7b** — the surface supports both a whole-direction pick and a per-section pick.
    The section axis comes from the archetype's required-section list (R3).
  - New GenUI surface kind `'gallery-select'` added to the `kind` zod enum
    (`packages/contracts/src/plugins/manifest.ts:91`) + a renderer in
    `apps/daemon/src/genui/` and `apps/web/src/`. Renders a card grid: thumbnail, name,
    palette swatch row, font pairing line, one-line rationale, and a select checkbox
    per-direction and per-section.
  - > **DECISION REQUIRED (blocks the live chat-triggered end of R7, does not block
    > R7's component itself).** Every existing GenUI surface request goes through the
    > plugin-pipeline system and carries a real `pluginSnapshotId` (§3 G3). There are two
    > honest ways to make the advisor request a `gallery-select` surface from mid-chat,
    > and picking between them is an architecture call, not an implementation detail:
    > (a) wrap the advisor as a proper plugin/pipeline stage so it gets a real snapshot
    > id "for free," or (b) generalize `requestSurface`/`RequestSurfaceInput` to accept a
    > non-plugin origin (e.g. a `sourceKind: 'plugin' | 'daemon-tool'` discriminator).
    > Neither is invented here as the answer — Devin decides which, because (a) reuses
    > proven machinery but forces the advisor into the plugin lifecycle it may not
    > otherwise need, and (b) is a core-subsystem change with its own review bar. **Until
    > this is decided, the `gallery-select` component can still be built and verified
    > against a fixed fixture payload (a Playwright test at `e2e/ui/design-advisor-
    > gallery-select.test.ts` importing from `@/playwright/suite`, rendering the surface
    > directly rather than driving it from a live agent turn) — that part is unattended-
    > ready. The "type a question in the home chat and watch the gallery appear inline"
    > flow is not, until this decision lands.**
- **R8 · Selection → project.** Confirming the selection starts a project seeded with the
  extracted brief and the chosen slugs, with no retyping.
  - **R8a** — the scaffold composes **one** project from the blended selection (Addendum
    A.1), recording which direction each section came from so the choice stays
    inspectable later. Extend `CreateProjectRequest`/`ProjectMetadata`
    (`packages/contracts/src/api/projects.ts`) with new **optional** fields — e.g.
    `directionSelections: { directionId: string; sections: string[] }[]` — so existing
    single-`skillId`/single-`templateId` project creation is untouched and this is
    additive, not a breaking schema change.
  - **Dual-track closure for R8a comes largely for free.** `POST /api/projects`
    (`apps/daemon/src/routes/project/index.ts:1663`) already accepts `metadata:
    ProjectMetadata` on `CreateProjectRequest`, and `od project create` already has a
    generic `--metadata-json <path|->` flag that reads a JSON file and merges it into
    `metadata` server-side (`apps/daemon/src/cli.ts:6923,7031-7032`) — confirmed by
    reading the CLI source, not assumed. Once `directionSelections` exists on
    `ProjectMetadata`, both the HTTP endpoint and the CLI already carry it; only the
    contract type extension and the web confirm-button wiring (part of R7) are net-new.
  - This backend piece (schema extension + project-creation logic) is independently
    buildable and testable tonight via a direct HTTP/CLI call carrying a synthetic
    selection payload — it does not depend on the R7 DECISION REQUIRED item.
- **R9 · i18n.** Every new user-facing string added to `apps/web/src/i18n/locales/en.ts`
  and `types.ts`; `pnpm i18n:check` green.

#### P1 — external inspiration

- **R10 · Refero MCP client.** Register `https://api.refero.design/mcp` as a daemon-side
  MCP server using the existing plumbing (`apps/daemon/src/mcp-config.ts`,
  `apps/daemon/src/mcp-tokens.ts`, `runtimes/mcp.ts`). **Correction to the original
  finding:** the bearer token is a credential, not public data — this repo already treats
  MCP bearer tokens as posting-as-you secrets requiring owner-only storage
  (`apps/daemon/src/mcp-tokens.ts:176-199`, chmod `0600` on the token file). Store it the
  same way every other MCP server's credential is stored in this product: either as a
  static `headers` value entered through the existing MCP settings UI
  (`McpServerConfig.headers`, `packages/contracts/src/api/mcp.ts:15-45`) or via the
  daemon's own OAuth flow (`authMode: 'oauth'`) — not hardcoded, not committed to the
  repo. **Do not add code that shells out to `zsvault`, `op`, or any other personal
  credential-manager CLI from daemon source** — those are the operator's own machine
  tooling for populating the setting locally, not something the shipped daemon depends
  on or should invoke itself.
- **R11 · Reference results are visually distinct and don't route through the local
  rights ledger.** Refero screens/styles appear in a separate "References" band, clearly
  not selectable-as-template. **Correction to the original finding:** the existing rights
  model (`apps/daemon/src/design-library/rights.ts:136-185,217-256`) verifies *local*
  catalog-relative directories against a local `.catalog/rights.json`/`RIGHTS.md`/tree
  hash — it has no mechanism for authorizing transient remote results and should not be
  invoked for them. Refero results carry their own `source`/`sourceUrl`/licensing fields
  from the MCP response and are never copied into `design-templates/` or promoted through
  the rights ledger; they are display-only inspiration, always.
- **R12 · Fallback trigger.** Refero is queried when local top score falls below a floor,
  or on explicit user request — not on every query. Failures degrade silently to
  local-only results; the advisor never hard-fails on an external outage.

#### P2 — refinement

- **R13** Conversational narrowing ("warmer", "less motion", "serif only") re-ranks without
  restating the brief.
- **R14** Side-by-side compare of selected candidates.
- **R15** Palette/type extraction upgraded from prose-parsing to rendered-page sampling of
  `example.html`, raising `confidence` across the catalog. **This is the direct fix for
  the ≥85%-coverage DECISION REQUIRED item in §4.6** if Devin decides the P0 measured
  baseline (54%/24%, §2) isn't an acceptable ship bar.
- **R16** The remaining 8+ small-business archetypes beyond `poetry` (R3), each authored
  with the same level of real content as Addendum A.3 — explicitly not something an
  unattended agent should invent to hit a headcount.
- **R17** Thumbnail generation/fallback for the 8 templates without root `example.html`
  and for thumbnails generally (§2 shows **zero** templates currently have one).

### 4.5 Risks

| Risk | Mitigation |
|---|---|
| Prose hex extraction is lossy — palettes are described, not declared, and coverage today measures 54%/24% (§2) | `confidence` field surfaces this honestly; R15 (P2) is the real fix; §4.6 DECISION REQUIRED covers whether 54%/24% ships as-is |
| Archetype list becomes an unbounded taxonomy | Fixed controlled vocabulary, gated by `validate-design-catalog.ts`; new archetypes are a deliberate edit, and P0 ships exactly one (`poetry`) |
| `gallery-select` duplicating GenUI, or GenUI's plugin-only invocation model being silently worked around | R7 explicitly extends the existing lifecycle and flags the plugin/generalize choice as DECISION REQUIRED rather than improvising a workaround |
| Ranking tuned to the demo query only | R4's P0 test covers the demo query + 2 paraphrases; broader goldens are P2 (R3/R16) |
| Refero latency on the main-page path | P1 only, floor-triggered, async, non-blocking |
| A second, parallel brief-matching system growing up beside `/api/catalogue/match` | R6 explicitly builds *alongside and reusing* the existing matcher's proven pattern, not a rival endpoint (§3 G1) |
| Index goes stale relative to source templates without anyone noticing | R2's added source-hash check fails validation on drift |
| Files touched vary in size; some (`ChatComposer.tsx`, `HomeHero.tsx`, `HomeView.tsx`) are large | Read before editing; keep new logic in new modules and integrate at a seam |

### 4.6 Success criteria (measurable)

P0 is done when **all** hold. Items marked **(blocked)** cannot complete unattended tonight
without the DECISION REQUIRED item in R7 landing first — see §6.

1. `node scripts/build-design-index.ts` emits `design-templates/index.json` covering
   **every template with a `SKILL.md`** — verify the count matches
   `find design-templates -mindepth 1 -maxdepth 2 -name SKILL.md | wc -l` run at the same
   time, not a hardcoded number; zero validator violations (`node
   scripts/validate-design-catalog.ts`).
2. **DECISION REQUIRED (does not block building R1, blocks the specific acceptance bar):**
   the original target was "≥85% of templates carry ≥3 palette hexes and a resolved
   display/body pairing at confidence high or medium." Measured 2026-08-18 against the
   described P0 extraction method, only **190/352 (54%)** SKILL.md files carry ≥3 distinct
   hexes and only **84/281 (24% of all templates)** `template.json` files list ≥2 fonts —
   an 85% bar is not reachable from R1's stated prose-extraction method alone. Devin
   decides: (a) ship P0 reporting the true measured percentage with no fixed pass/fail
   threshold on it (only genuine data-integrity violations — invalid hex, out-of-
   vocabulary mood — fail the validator), or (b) pull R15's rendered-page sampling
   forward from P2 into P0 to raise real coverage before committing to any percentage.
   Until decided, the build/validate/test loop is not blocked — only the specific "≥85%"
   assertion is.
3. The literal demo query — *"hey, can you please tell me the best templates to use for a
   small business poetry website? please let me know colors and fonts too."* — returns
   **≥6 ranked candidates**, each with palette swatches, a named font pairing, and a
   rationale that names the matched fields, via `od design-advisor recommend --prompt
   "..." --json` (R6).
4. **Automated oracle replacing the original human-judgment criterion.** The original
   text ("a human reviewing the top 6 judges ≥4 genuinely appropriate") cannot complete
   unattended and is removed as a P0 gate. Replaced with: of the ≥6 ranked candidates for
   the demo query, **at least 4 score ≥0.5** on R5's poetry-archetype rubric (the same
   score R5 already computes per candidate — this is checking the ranker's own stated
   confidence, not inventing a second metric). This is enforced by a unit test with a
   frozen expected-slugs-or-better-score assertion against the fixed R1/R3 index, so it's
   re-checkable on every run, not a one-off. A genuine visual/craft sanity check of the
   picks is moved to the non-blocking morning-review list in §6 — it belongs there, not
   as a completion gate.
5. **(blocked on R7 DECISION REQUIRED for the live-chat half)** The `gallery-select`
   surface renders the candidates from a fixed fixture payload and multi-select + confirm
   works, verified in `e2e/ui/design-advisor-gallery-select.test.ts` (flat file, imports
   `test`/`expect` from `@/playwright/suite` — **not** `specs/*.spec.ts`, which is the
   Vitest business-chain tree per `e2e/AGENTS.md:7-18` and would not even be discovered
   by Playwright, whose config only searches `./ui`, `e2e/playwright.config.ts:30-41`).
   Confirming starts a project carrying brief + selected slugs (R8a), verified via a
   direct API/CLI call — this half does not depend on R7's decision and is unattended-
   ready. The end-to-end "type in home chat → gallery appears inline → confirm" path is
   blocked until the R7 architecture decision lands.
6. `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check` all exit 0.

### 4.7 Verification

```bash
cd ~/projects/mishmash

# Re-measure the template count and coverage baseline before trusting any number above:
find design-templates -mindepth 1 -maxdepth 2 -name SKILL.md | wc -l
find design-templates -mindepth 2 -maxdepth 2 -name example.html | wc -l
find design-templates -mindepth 2 -maxdepth 2 -iname '*thumb*' | wc -l

# R1/R2 — index build + gate
node scripts/build-design-index.ts
node scripts/validate-design-catalog.ts

# R3/R4/R5/R6 — advisor unit tests + the literal demo query via the real CLI closure
pnpm --filter @open-design/daemon test
od design-advisor recommend --prompt "hey, can you please tell me the best templates to use for a small business poetry website? please let me know colors and fonts too." --json

# R8a — project creation from a synthetic blended selection, without needing R7 answered.
# `--metadata-json` already exists on `od project create` (apps/daemon/src/cli.ts:6923,
# 7031-7032) and merges arbitrary JSON into ProjectMetadata server-side, so this proves
# the backend closure once `directionSelections` is added to the contract:
echo '{"directionSelections":[{"directionId":"literary-journal","sections":["hero","poem-layout"]}]}' > /tmp/f001-selection.json
od project create --name "F001 selection smoke test" --metadata-json /tmp/f001-selection.json --json

# R7 component-level check (does not require the R7 architecture decision)
pnpm --filter @open-design/e2e exec playwright test e2e/ui/design-advisor-gallery-select.test.ts

# Repo-wide gates
pnpm guard && pnpm typecheck && pnpm i18n:check
```

---

## 5. Open questions for Devin

1. **Result count.** "All the viable options" — cap the grid at ~12 with a "show more", or
   return everything above the score floor however long that is? **Provisional P0
   default so this doesn't block execution: cap at 12 (Devin's own number from this
   question), no "show more" UI yet.** Flip to unlimited-above-floor only on explicit
   confirmation — this default is a scoping choice to keep P0 moving, not a resolved
   answer to the open question.
2. ~~**Multi-select semantics.**~~ **ANSWERED 2026-08-18 — one project, blending the
   selections together.** See Addendum A.1; R8/R8a are updated accordingly.
3. **Refero weight.** Reference-only inspiration (P1 as written), or should Refero results
   be first-class enough to seed a project from directly? (P1, does not block P0.)
4. **NEW — R7's GenUI invocation architecture.** See the DECISION REQUIRED block under
   R7 in §4.4: wrap the advisor as a plugin/pipeline stage, or generalize GenUI's
   `pluginSnapshotId` requirement to accept a non-plugin origin. This is the one decision
   that blocks the fully-live, chat-triggered end-to-end demo (see §6).

---

---

## Addendum A — 2026-08-18, same session

### A.1 Multi-select semantics — RESOLVED

**One project, blending the selections together.** Not N projects, not N pages.

Devin also specified the picker's framing: *"the sirch should pull up something like
**PICK ONE OR EACH SECTION**"*. So blending is two-level:

- **Direction level** — pick one named direction wholesale, or
- **Section level** — mix sections across directions (hero from #2, poem layout from #1).

This supersedes R7 and R8 (already folded into §4.4's R7/R7a/R7b/R8/R8a above):

- **R7a** — `gallery-select` presents **named directions**, not just template cards. Each
  direction carries a name, a one-line character description, *what it's good for*, and
  *when not to pick it*. Templates sit under the direction that matches them.
- **R7b** — the surface supports both a whole-direction pick and a per-section pick. The
  section axis comes from the archetype's required-section list (R3), so the two features
  share one source of truth.
- **R8a** — the scaffold composes **one** project from the blended selection, recording
  which direction each section came from so the choice stays inspectable later.

### A.2 Answer-shape contract

Devin supplied a worked example of the response he wants (full text preserved in
`F001-reference-answer.md`). Its structure is now the **response contract** for R5/R6:

| Block | Content | Requirement |
|---|---|---|
| Template directions (pick one) | 3–5 named directions; each = character sentence + *good if…* + honest *only pick it if…* | R7a |
| Colors | 2–3 named palettes; every hex **role-labeled** | R1 |
| Rule of thumb | One-line discipline note (e.g. *"one accent, links and a single button"*) | R5 |
| Fonts | `Use / Font / Why` table + alternates + licensing note | R1 |
| Craft details | The typesetting rules that matter more than the font pick | R3 |

Two things this pins down, **already applied directly in R1 above rather than left as a
separate provisional-vocabulary reconciliation**:

- **Palette role vocabulary:** `background`, `text`, `muted`, `rule`, `accent`.
- **Type role vocabulary:** `body` (poems/long text), `body_alt`, `headings`, `ui`.

**Voice matters as much as structure.** The example says a direction is *"harder to keep
looking professional"* and *"Poetry sites die from too much color."* The advisor is
expected to have an opinion and to name the downside of a direction — not to present five
neutral options. Route the generated prose through the `stop-slop` discipline.

> ⚠️ **DECISION REQUIRED — external platform recommendations (does not block P0's core
> loop).** The reference answer includes a *"Concrete off-the-shelf options"* block naming
> Squarespace, Ghost, WordPress, and Cargo, and says *"Ghost is the one I'd point a poet
> at."* Inside MishMash that block would send a user to a competing product from the
> primary entry point. **Safe unattended default: omit this block entirely for P0** rather
> than either fabricating a MishMash-only substitute or naming competitors without
> sign-off — both are product/business calls. Recommendation for Devin to confirm: keep
> the block's *shape* (concrete named picks with a reasoned favourite) but populate it
> from MishMash's own design systems and template families instead of external platforms.
> Flagged rather than silently dropped or silently shipped; Devin's call, not invented
> here.

### A.3 `poetry` archetype — seed data

Devin's example doubles as the first archetype's real content. This is implementable
as-is for R3 (`apps/daemon/src/design/site-archetypes.ts`) and is the pattern the other
(P2, R16) archetypes should follow.

**Directions**

| Direction | Character | Good if | Caution |
|---|---|---|---|
| Literary journal | Wide serif column, generous line height, almost no imagery; poems live in the layout | The writing is the product | Safest, most credible |
| Small press / bookshop | Hero with one book cover, shop grid, about, mailing list | You sell physical or digital books | — |
| Poet portfolio | Big name, short bio, featured poems, readings calendar, contact | Bookings and workshops | — |
| Zine / risograph | Off-white paper, one loud ink, tight type | Poetry is playful or political | Harder to keep professional |

**Palettes**

```jsonc
{
  "paper-and-ink": {           // literary journal
    "background": "#FAF7F2",   "text": "#1A1A18", "muted": "#6B6862",
    "rule": "#E0DAD0",         "accent": "#8A3324"   // burnt sienna — links only
  },
  "dusk": {                    // evening readings, moodier work
    "background": "#14161A",   "text": "#EDE8E0", "muted": "#8C8F95",
    "rule": "#282C33",         "accent": "#C8A55B"   // aged brass
  },
  "riso": {                    // zine
    "background": "#F2EFE6",   "text": "#111111",
    "accent": ["#FF4A1C", "#2B44FF"]                 // ONE only, used loud
  }
}
```

Discipline: **one accent, used for links and a single button.** *"Poetry sites die from
too much color."*

**Typography**

| Use | Font | Why |
|---|---|---|
| Poems + body | EB Garamond · Crimson Pro | Old-style, warm, holds long stanzas |
| Alternative body | Newsreader · Source Serif 4 | More modern, screen-tuned |
| Headings | Fraunces (soft optical) · Playfair Display | Character without shouting |
| UI, nav, captions | Inter · system-ui | Stays out of the way |

All free on Google Fonts.

**Typesetting constraints — these are scoreable, not decorative**

| Constraint | Value |
|---|---|
| Body size | 19–21px |
| Line height | 1.65–1.75 |
| Measure | ~62 characters (`max-width: 34rem`) |
| Poem alignment | Left-align. **Never** justify. **Never** center a whole poem. |
| Line breaks | Preserved exactly — `white-space: pre-wrap` on poem blocks so stanza indentation survives |
| Wrapped lines | Hanging indent, so a long line doesn't read as a new one |

**This tightens R5.** These are not prose advice — they are **ranking inputs**. A template
whose body measure runs 80ch, or which centers long text blocks, must score *down* for the
poetry archetype even if its palette is perfect. Encode them as scored constraints in the
index (R1) so ranking is deterministic and testable.


---

---

## Addendum B — 2026-08-18: the index is shared with F007

F007 (filter standardization) consumes **this finding's index**. Devin's instruction:

> *"these too should be filterable though a similar lense as what we are creating the search
> aggregator to do, want theme, section, style, ect"*

So R1's `index.json` is not advisor-private — it is the single source for both the advisor's
ranking and the app's filter dropdowns. **See F007 Addendum A for the authoritative facet
table**; it adds `sections[]`, `style`, and `theme` to the palette/typography/mood/density/
motion fields specified here.

> **Field-name correction (2026-08-18):** F007's own text defines this field as `sections[]`
> (plural, array — `F007-filter-standardization-and-section-facets.md:132`). An earlier
> draft of this addendum referred to it as `section` (singular), which the F007 audit
> flagged as a cross-file naming mismatch. `sections[]` is the field name both consumers
> must use.

Binding consequence for R1: **any facet the advisor ranks on must be exposed to the filters,
and any facet the filters expose must be rankable.** Build the vocabulary in
`scripts/design-taxonomy.ts`, gate it in `validate-design-catalog.ts`, and let both consumers
read it. Do not add an advisor-only field.

F007's own audit additionally notes it depends on artifacts (`design-templates/index.json`,
`scripts/build-design-index.ts`) that don't exist yet — i.e. **F007 cannot start its
section-facet work (F007 R7) until this finding's R1/R2 land.** Sequence accordingly; this
finding does not need to wait on F007.

---

## 6. What is and isn't unattended-ready tonight

Buildable, testable, and verifiable by an agent tonight with no human judgment call:

- R1 (index build + confidence fields), R2 (validator + new staleness check)
- R3 scoped to the single `poetry` archetype (fully specified in Addendum A.3)
- R4 (brief extraction via the proven `matchCatalogue` pattern), R5 (ranking + scored
  typesetting constraints)
- R6 (HTTP + contract + CLI closure for `design-advisor recommend`) — a plain
  request/response endpoint, no GenUI dependency
- R7's `gallery-select` **component**, tested against a fixed fixture payload
- R8/R8a's **backend** schema extension and project-creation logic, tested via direct
  API/CLI calls with a synthetic selection payload
- R9 (i18n), R2's validator wiring into `pnpm guard`

Blocked on a real decision, not safe to improvise unattended:

- **R7's GenUI invocation architecture** (§4.4 DECISION REQUIRED) — whether the advisor
  becomes a plugin/pipeline stage or GenUI's plugin-only model is generalized. This is
  what blocks the literal "type a question in the home chat, watch the gallery appear
  inline" flow — success criterion 5's live-chat half.
- The §4.6 item 2 coverage-threshold decision (ship at the measured 54%/24% baseline, or
  pull R15 forward) — does not block building R1, only the specific bar it's graded
  against.
- The external-platform-recommendations call (Addendum A.2) — P0 default is to omit the
  block, so this does not block execution, only the richer version of the answer.
- R3/R16's 8+ non-poetry archetypes and R10-R12's Refero integration are explicitly P1/P2
  and out of scope for tonight regardless.

**Non-blocking morning review** (do not gate the run on these — check when a human is
next awake):
- Does the ranked top-6 for the poetry query actually *look* right to a person with design
  taste, beyond the automated ≥0.5-score check in success criterion 4?
- Does the `gallery-select` visual design read as intentional, not just functional?
- Sanity-check whatever the R7 architecture decision produced against the rest of the
  plugin-pipeline system's assumptions once it's built.

## Revisions

- 2026-08-18 — captured live during team demo; grounded against code the same session.
- 2026-08-18 — **Addendum A**: blend semantics resolved (one project), answer-shape
  contract fixed, palette/type role vocabularies pinned, `poetry` archetype seeded with
  real data, and R5 tightened so typesetting rules become scored ranking inputs.
- 2026-08-18 — **Addendum B**: index confirmed shared with F007's filters;
  facet vocabulary is common to both.
- 2026-08-18 — **Repair pass, audit-verified.** Applied `audits/F001-audit.md` after
  independently re-checking every factual claim against the repo (all confirmed
  accurate). Corrected: template count 353→352 (with the `AGENTS.md`-file miscount
  explained); `template.json` claimed as universal metadata, actually 281/352 vendored-
  only; the "matcher returns nothing for poetry" claim, actually returns one irrelevant
  match via a generic "business" trigger; the "palette only in prose description" claim,
  actually role-labeled in some SKILL.md bodies at uneven 54%/24% coverage (measured, not
  invented); the false `evals/selector/nl-to-ir/` precedent, replaced with the real,
  working `matchCatalogue` pattern; the missing `/api/catalogue/match` existing-capability
  citation, added throughout so this finding extends rather than duplicates it; the
  `connectors.ts`-as-tool-registry claim and the unexamined GenUI plugin-invocation
  assumption, replaced with a named DECISION REQUIRED architecture question; the Refero
  bearer-token-is-public and rights.ts-covers-remote-results claims, both corrected to
  match how this repo actually treats MCP credentials and local-only rights; added the
  missing dual-track (HTTP/contract/UI/CLI) closure for R6 and R8a per AGENTS.md
  "Capability exposure"; fixed the Playwright test path from `specs/*.spec.ts` (Vitest
  tree, would not run) to `e2e/ui/*.test.ts` importing `@/playwright/suite`; replaced the
  human-judgment success criterion 4 with an automated score-threshold oracle and moved
  genuine taste review to a new non-blocking §6 morning-review list; converted the
  unverified "≥85% confidence" success bar into a measured-baseline DECISION REQUIRED
  item; rescoped R3 to the single fully-specified `poetry` archetype for P0, moving the
  other 8+ archetypes to P2 (R16) rather than leaving them unspecified inside a P0
  requirement; fixed the F007 Addendum B field-name mismatch (`section` → `sections[]`)
  flagged by the F007 audit; added new §6 splitting unattended-ready work from
  decision-blocked work.
