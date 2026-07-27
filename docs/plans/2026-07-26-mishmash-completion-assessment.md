# MishMash — Completion Assessment & Next-Move Register

**Date:** 2026-07-26
**Purpose:** Establish verified ground truth on what is done vs. remaining, expand the
BUILD BACKLOG note into executable next-move items, and feed wave planning.
**Sources:** Apple Note "MISHMASH — BUILD BACKLOG" (reorganized 2026-07-26); two
full-tree inventories run today; goal-run history across 4 MishMash runs; GitHub
capability sweep; live verification of third-party tooling.
**Status:** DRAFT — pending Grok 4.5 + GPT-5.6 Sol audit.

---

## 0. Executive summary

The backlog note's **rebrand audit (A1) is substantially stale** — most of what it
lists as pending has already shipped. Two other large items (**B reference intake**,
**C1 brand extraction**) are far more built than the note assumes: intake is a complete
system hidden behind a feature flag, and brand extraction is a working deterministic
engine. Three items are **already fully done** (0.1 CodeGraph, J5 default design system,
K3 Vercel). One item's premise is **obsolete** (D5 Gemini CLI). One is **much smaller
than written** (F1 VoiceBox already ships an MCP server).

Conversely, the note **understates** several real gaps: there is no thumbnail
generation pipeline at all (I1 is greenfield, and brand extraction lost its screenshot
input to an SSRF fix); the model-picker mismatch (D1) has three distinct confirmed
mechanisms, not one; and the true rebrand surface is a 602-import npm package scope
rather than UI copy.

**Net:** the remaining work is smaller than the note implies in the rebrand/library
areas and larger in the routing-trust, thumbnail, and net-new-feature areas.

---

## 1. Verified DONE (no further work)

| ID | Item | Evidence |
|---|---|---|
| D-01 | **0.1 CodeGraph indexing** | `.codegraph/codegraph.db` (239 MB) at repo root, re-indexed 2026-07-26 20:21 |
| D-02 | **0.2 CLAUDE.md intact** | Thin pointer → `AGENTS.md` + `docs/design-authority.json`; matches repo policy |
| D-03 | **J5 default = "No design system"** | `state/config.ts:82` `designSystemId: null`; `en.ts:876` `designSystemPicker.noneTitle` |
| D-04 | **K3 Vercel integration** | `daemon/src/deploy.ts` (2,012 lines) + `routes/deploy.ts` (282) — BYOK Vercel deploy/poll/protected-deployments; Cloudflare Pages alternate |
| D-05 | **J2 Archive concept** | `od project archive <id>` CLI (`cli.ts:6174`), `/api/projects/:id/archive`, design-system `archive` analytics action |
| D-06 | **A3 non-English locales** | Single `en.ts` locale; all other locale dictionaries removed in the de-bloat pass; policy recorded in `AGENTS.md` |
| D-07 | **A1 design-system manifests** | All 150 now read "Bundled **MishMash** package for …"; the note's 1,350-hit phrase has 0 occurrences |
| D-08 | **A1 MCP tool titles** | Already "List/Get/Create MishMash project", "Generate with MishMash" |
| D-09 | **A1 OAuth consent name** | `mcp-oauth.ts:256` already `client_name: 'MishMash'` |
| D-10 | **A1 social share text** | Already "Built with MishMash: ${title}" |
| D-11 | **A1 whats-new domain** | No `open-design.ai` fetch exists; env-var-only, upstream fallback deliberately removed |
| D-12 | **A1 clipper UI copy** | "MishMash Web Clipper" throughout popup/content/background/brand-capture |
| D-13 | **A1 brand SVGs** | `logo.svg`, `brand-icon.svg`, `app-icon.svg` = MishMash monogram, pinned by `home-logo-assets.test.ts` |
| D-14 | **K2 dead-weight removal (first pass)** | `apps/nextjs`, `packages/shared`, `apps/desktop`, `apps/packaged`, `apps/landing-page` all confirmed removed |
| D-15 | **B6 GitHub sweep (research)** | Completed 2026-07-26; 5 qualifying repos + auditable rejected list (see §6) |

**Also completed this session (feeds the ledger):** web-clone capture hardening across
3 commits with a mandatory verify-mirror gate; designbybrandin + theothersideoftruth
clone rescues; Instatic evaluated. See §7 for its open disposition.

---

## 2. Note corrections (stale or inaccurate claims)

The A1 audit block in the note describes a **pre-rebrand state**. Corrections:

| Note claim | Verified reality |
|---|---|
| design-systems: 1,806 hits / 5 literal patterns | **301 hits**, of which 300 are the inert field `"sourceScope":"open-design-bundled-fixture"` (read by no source file) + 1 schema comment |
| "Bundled Open Design package for <NAME>" ×1,350 | **0 occurrences** — already says MishMash ×150 |
| ~30 hardcoded `.tsx` strings | **41 files match, 40 are code comments.** Exactly **1** real literal, and it is a deliberate legacy-recognition shim so pre-rebrand projects still render |
| `mcp.ts` ×49 | **2** (a contracts import + `SERVER_NAME='open-design'`) |
| `mcp-oauth.ts:256` client_name 'Open Design' | Line correct; value already 'MishMash' |
| `whats-new.ts:30` live fetch to open-design.ai | **No such fetch exists anywhere** |
| A2 labels `open-design-community` / `-official` | `community`: **0 occurrences**. `official`: 1, in a test fixture. Real taxonomy is `mine/official/enterprise` (design systems) and `official/trusted/restricted` (plugins) |
| Live `.od/` data: 72 files, 464 MB | Now **1.1 GB** (`.od/projects` alone 987 MB) — grew, still gitignored local runtime data |

**What the note got right:** `152` design-system directories (151 + `_schema`); the
`mcp-oauth.ts:256` line number; `primitives.css:331` as the brand-glyph location; and
the core instinct that a rebrand tail exists — it's just a different tail (see NM-01).

---

## 3. Open questions — resolved

| Question | Answer |
|---|---|
| **Voice Box — Meta's Voicebox or another product?** | Neither. It is **your own app**: `~/projects/tools/third-party/voicebox` — Tauri + Bun + Python backend, voice cloning + global-hotkey dictation. **It already ships an MCP server** (HTTP `127.0.0.1:17493/mcp`, tool `voicebox.speak`, plus a bundled `voicebox-mcp` stdio binary for non-HTTP clients, managed in Settings → MCP). F1 is therefore *tethering*, not *building* |
| **"OKF by Google"** | No Google product matches. Real candidates: **Gemini File Search** (managed RAG in the Gemini API) or **Vertex AI RAG Engine**. Decision deferred to NM-14 research; note that the repo already has a working non-vector memory system and a dormant `library_embeddings` table |
| **"model picker be a TLI"** | Reads as CLI — consistent with the picker's Mode = CLI/BYOK toggle |
| **Instatic spelling** | Correct. Cloned to `third-party/instatic`, Bun-only, evaluated 2026-07-25 |
| **"mission management project"** | Almost certainly a transcription of **MishMatch** — a *different* product (`zs-acquisition-engine`/`zs-crm`/`zs-workbench`) whose goal-runs sit next to MishMash's in `~/.claude/goal-state/`. Its open items are **excluded** from this backlog |
| **"term agreements"** | No matching surface found in the repo. Recommend dropping unless you recall the intent |
| **B6 GitHub sweep scope** | Resolved by execution: scoped to 8 capability areas, high bar, empty results allowed. See §6 |

---

## 4. Remaining next-move register

Each item: current state → work required. IDs are stable for wave assignment.

### Rebrand tail

**NM-01 — Rename the `@open-design/*` npm scope.** *(A1, real surface)*
16 workspace packages (`contracts`, `components`, `host`, `daemon`, `sidecar`, …) with
**602 imports** across `apps/`, `packages/`, `tools/`. Mechanical but wide; touches every
`package.json`, `tsconfig` path, and import site. Needs a codemod + full typecheck/test
sweep. **This is the one big rebrand item left.**

**NM-02 — Replace stale PNG brand assets.** *(A1, user-visible)*
`apps/web/public/app-icon.png` and `logo.png` are still the **old Open Design cursor
glyph**, and `app/layout.tsx:12-13` wires `app-icon.png` as favicon *and* apple-touch-icon
— so the browser-tab icon is still the old brand. Not covered by the SVG regression test.
Regenerate PNGs from the MishMash monogram; extend `home-logo-assets.test.ts` to cover them.

**NM-03 — Decide the internal-identifier policy.** *(A1, judgment call)*
`SERVER_NAME='open-design'`, `OPEN_DESIGN_GITHUB_REPO_URL`, `.od-brand-glyph`, `.od/` data
dir, `OD_*` env vars, `od` CLI binary. All internal; renaming is invasive and risks breaking
the MCP bridge and stored config. **Recommendation: keep, document as deliberate**, rename
only user-visible surfaces. Requires your ruling.

**NM-04 — Strip orphaned Chinese i18n key + toolbox searchTerms.** *(A3 tail)*
`en.ts:3521` `settings.memoryEmptyHintZh: '记住: 用户偏好深色主题'` — unreferenced by any
component or test. Plus `design-toolbox.ts` `searchTerms` Chinese entries (carried from the
gap-fix run). Small, safe deletions.

**NM-05 — Rebrand `README.md`.** *(A1, high-visibility)*
55.9 KB, still fully upstream-branded — hero banner, "Open Design Cloud", Discord links.
The most-read file in the repo and entirely untouched by the de-brand passes.

**NM-06 — Retire `open-design-public-metadata` route.** *(A1 + K1)*
`routes/open-design-public-metadata.ts` (74 lines) serves `/api/github/open-design` GitHub
stats and a Discord invite for the *upstream* project. Dead-ish surface for a private fork;
delete or repoint.

### Reference intake (B) — un-hide, don't rebuild

**NM-07 — Flip `LIBRARY_UI_VISIBLE` and re-validate the surface.** *(B1-B3 foundation)*
`features/libraryUi.ts` is `false` with the comment that the OD Library is intentionally
hidden "for this release". Behind it: `LibrarySection.tsx` (global asset registry, source +
kind badges, back-links, SSE `/api/library/events`), `LibraryUploadModal.tsx` (choose-files,
**drag & drop**, paste of image/file/clipboard/text/JSON, size policy), the `clipper/` MV3
extension (full-page HTML snapshot, design-system extract, Figma JSON, element picker, bulk
images, screenshot), and daemon `library.ts` + `library-store.ts` (SQLite). Work = flip the
flag, walk every gated call site (`router.ts`, `EntryNavRail`, `EntryShell`,
`ComposerPlusMenu`, `DesignFilesPanel`, `DesignSystemAssetDropzone`), fix whatever rotted
while hidden, and decide the nav placement.

**NM-08 — AI enrichment for ingested references.** *(B2 auto-tagging)*
Today tagging is rule-based file-kind only; `library.ts` explicitly records
`skipped: ai: caption/ocr/embedding skipped (no model configured)`. Work = wire caption/OCR
(and optionally embeddings) to a configured model lane, then surface tags as filters.

**NM-09 — Light up `library_embeddings`.** *(B3 + G1 overlap)*
The table exists (`asset_id, model, dim, vector BLOB, indexed_text`) with **zero referencing
code**. Work = embedding generation on ingest + a similarity query path + search UI. This is
the concrete form "make references usable" and the design-side of the memory question.

**NM-10 — Chrome bookmark import.** *(B4)*
No importer exists. Needs: bookmark-file parse, per-URL title/description/thumbnail
resolution, dedupe, and Library asset creation. **Karakeep** (see §6) already solves this
shape if run as a companion service; otherwise first-party.

**NM-11 — Wire skills/design-files/repos/model-selections into intake.** *(B5)*
Scoping needed — currently reads as "make the Library aware of the other asset classes."
Recommend deferring until NM-07/08 land so the real gap is visible.

**NM-12 — Test + document the wired surface.** *(B7)*
Note: the design toolbox has **no test asserting its 16 action→skill mappings** — the
gap-fix run found 17 phantom skill IDs and added a repo-root guard, but daemon-suite
coverage is generic-skills-level only. This is E2's natural home too.

### Model routing trust (D)

**NM-13 — Fix the picker/executor mismatch.** *(D1-D3)* — **three confirmed mechanisms:**
1. **Codex has no execution echo.** Its `thread.started` event carries only `sessionId`, no
   model — so the UI can only show what was *requested*, never what ran. (Claude/Gemini-shaped
   `init`/Cursor `system/init` all report `model`, which `AssistantMessage.tsx` displays.)
2. **Antigravity races.** `agy` has no `--model` flag; the daemon writes the choice into the
   **process-global** `~/.gemini/antigravity-cli/settings.json` immediately before spawn.
   Two concurrent non-default runs can swap models. Mitigated by a lock that greps a log file
   for a propagation line with a timeout — reduces, does not eliminate. Also `streamFormat:'plain'`
   → no structured init event at all, so no per-turn confirmation.
3. **Silent daemon-side fallback.** `agentModelSelection.ts` client-side correction is
   **hardcoded to `agent.id === 'amr'`**. Every other agent keeps a stale/disabled model id in
   the UI; `resolveModelForAgent` substitutes silently with no user-visible warning.
   Also: `run.model` (telemetry) records the *raw requested* model, set before resolution —
   so even analytics can disagree with what executed.
**Work:** surface the executed model as authoritative (echo where available, explicit
"unverified" state where not), warn on substitution (D3), extend client-side correction beyond
`amr`, and decide Antigravity's honest ceiling.

**NM-14 — Gemini lane decision.** *(D4-D5)*
D4 is **already done** (Antigravity wired, binary `agy`). D5 as written is **obsolete**: no
standalone Gemini CLI def exists, and the legacy `gemini` CLI lost individual-tier auth in
June. Gemini reaches MishMash via Antigravity's catalogue or BYOK Google protocol. Work =
confirm that's sufficient, or add a first-class Gemini BYOK lane.

### Project types (C)

**NM-15 — "Create Client Website" project type.** *(C1)*
Primitives already exist: `daemon/src/brands/` (96 KB + `engine/`) does URL → prefetch →
seed → derive → `DesignTokens` → themed kit + artifacts, deterministically with no LLM;
`brand-routes.ts` exposes the full lifecycle; design-system **apply** is already an
instrumented action. Work = a guided `ProjectKind` (`'client-website'`) that chains
extract → confirm → apply-to-reference in one flow, plus document/upload-based token entry
(the note asks for "from their documents" as well as from a URL).
**Blocked-ish:** brand extraction lost its screenshot vision input (see NM-17).

**NM-16 — "Mishmash Selector".** *(C2)* — **the flagship, fully greenfield.**
Take 1–4 references (URL / library / upload), accept natural-language directives ("layout of
A, animations of B, palette of C, that section of D"), compose, and emit **3 prototype
variants** the user picks from. No code exists in the repo; the GitHub sweep found nothing
integrable anywhere (only an academic project with no code release). This is the item that
most defines the product and needs its own spec + eval harness.

### Quality & infrastructure

**NM-17 — Restore brand-extraction vision input.** *(new, blocks C1 quality)*
`brands/prefetch.ts` had its server-side page screenshot **permanently removed** because the
headless-Chrome capture couldn't be constrained to public hosts (SSRF); `screenshot` is now
hardcoded `null`. Work = a properly sandboxed capture path (allowlist/proxy/egress control),
or route through the already-hardened web-clone Playwright pipeline, or accept the degradation
explicitly.

**NM-18 — Thumbnail pipeline.** *(I1)* — **greenfield.**
There is **no** screenshot/rasterization pipeline. Project cards render a **live sandboxed
iframe** of the project's `index.html`, CSS-scaled, with a glyph fallback on 404
(`project-cover.tsx`). That's clever but fragile and can't produce a stored thumbnail for a
clone or a gallery card. Work = capture (reuse the hardened web-clone Playwright path) →
hero/salient crop (**sharp**'s `attention` strategy, see §6) → store → render, with the iframe
as fallback.

**NM-19 — Design-toolbox reliability + tests.** *(E1-E2)*
16 actions (`auto-match`, `asset-search`, `icon-workflow`, `image-replace`, `reference-extract`,
`motion`, `motion-polish`, `transition-motion`, `plan-outline`, `threejs-scene`,
`anti-ai-polish`, `visual-polish`, `image-gen`, `chart-gen`, `logo-gen`, `video-gen`) resolve to
skill IDs and flow through the generic skills pipeline — the daemon has no toolbox concept.
Work = exercise each end-to-end from the side panel, add mapping assertions to the daemon suite
(not just the repo-root guard), and fix what breaks.

**NM-20 — Cost & usage dashboard.** *(H1)*
The hard part is done: `run-analytics-observability.ts` normalizes input/output/total/cache
tokens across provider conventions, `codex-rollout-usage.ts` handles Codex's cumulative-only
stream, and `langfuse-trace.ts` computes `cost_usd` with a `pricing_version` marker feeding an
in-repo Langfuse bridge. **No user-facing meter exists** (closest is the AMR wallet balance).
Work = aggregation + UI, total and per project. **Langfuse** self-hosted (see §6) is a
credible shortcut since the bridge already exists.

**NM-21 — Memory system decision.** *(G1)*
Existing: a working markdown two-loop system (`memory.ts`) — PRE (query rewrite + user-profile
injection), POST (regex extraction inline in `startChatRun`, LLM fallback in `memory-llm.ts`),
with a settings UI. No vectors. Work = decide whether design-reference retrieval (NM-09) and
chat memory converge on one embedding store, and resolve the "OKF" candidates. **Recommendation:
scope G1 to the Library-embeddings use case rather than replacing a working chat-memory system.**

**NM-22 — Route hardening.** *(K1)*
~239 endpoints across 35 route files. Needs a systematic pass: auth/authorization posture,
input validation at boundaries, SSRF review (note the brands precedent), and rate/size limits.
Deserves its own security-focused wave with adversarial review.

**NM-23 — Second de-bloat pass.** *(K2)*
`tools/pack` is dormant (packages an Electron shell that no longer exists) but occupies 6.4 MB.
`story/STORY.md` is a 0-byte stub. Bigger fish are gitignored but real on disk: `.tmp/` **30 GB**
(`.tmp/e2e` 27 GB), `.od/` 1.1 GB — housekeeping, plus a policy for bounding e2e artifacts.

**NM-24 — Instatic tether.** *(A4)*
Zero references in the repo. Instatic is Bun-only (`engines.bun >=1.3.0 <1.4.0`), ships a Core
Framework token engine, a QuickJS-WASM plugin sandbox, an **MCP server**, and "Super Import"
(static zip → pages/tokens/media). Work = decide integration shape. **The MCP server + Super
Import are the natural seam**: MishMash produces a static site → Instatic imports it as a CMS-
backed site. Priority is functionality over shared brand identity (your call in the note).

**NM-25 — VoiceBox MCP tether.** *(F1)* — **much smaller than written.**
VoiceBox already exposes `voicebox.speak` over HTTP MCP at `127.0.0.1:17493/mcp` plus a stdio
binary. Work = register it in MishMash's MCP client config, decide its relationship to the
existing BYOK speech lanes (ElevenLabs / FishAudio / SenseAudio under `AudioKind` projects), and
define where voiceover fits a design workflow (video projects?).

**NM-26 — Documentation set.** *(0.3)*
`AGENTS.md` (39.4 KB) is the SoT; `docs/` has 34 files but `spec.md` and `roadmap.md` are
**archived** — and that caveat lives in `AGENTS.md`, not in the files themselves, so a reader
browsing `docs/` can absorb stale product claims. No CODEMAPS. Work = generate the missing set,
mark archived files in-file, and add an onboarding path beyond `QUICKSTART.md`.

**NM-27 — Library/gallery organization.** *(J1-J4)*
- J1/J2: curate what's valuable; Archive **already exists** as a mechanism (D-05) — the work is
  *classification policy*, not plumbing.
- J3: the "Community" heading is `pluginsHome.title` (`en.ts:891`) on the **plugin/template**
  gallery — rename to something that describes plugins/templates.
- J4: grouping video styles/workflows and **HyperFrames** — note that HyperFrames is a
  *media-generation provider/model* surfaced as a task-type chip, **not** a design-system
  category, so "group HyperFrames" means grouping media-task entry points.

**NM-28 — Daemon test-suite debt.** *(carryover)*
20 pre-existing daemon test failures were recorded during the de-bloat run (including a
marketplace count invariant broken pre-debloat); the suite has since been greened and made a
merge gate, so this needs re-measurement against current `main` before it's either closed or
re-opened as real work.

### Carryover decisions (small, need your ruling)

**NM-29** — Frozen `t4-scroll` scroll-speed bug: needs a concrete sighting from you in the now-
completed clone, or formal closure.
**NM-30** — `C7b` mirror-width threshold deviation (deterministic 1441 px accepted over the
literal "within 5% of 1823 px") — one-line reversible, awaiting override.
**NM-31** — `od2-debloat` worktree + branch retained pending your deletion confirmation.
**NM-32** — Motion-library adoption backlog (OGL, curtains.js, swup, use-gesture,
react-three-rapier) under the ADR's one-at-a-time rule.
**NM-33** — Kimi ACP lane blocked on a paid Kimi Code membership decision; print-mode is the
working substitute. Also: Kimi non-Bash tool failures **silently parse as success** — a
documented blind spot worth a guard.
**NM-34** — Deeper Higgsfield media-provider integration (Settings → Media); skill lane is interim.

---

## 5. Sequencing critique

**Your proposed order:** `0 → A → B1-3 → B4-7 → D → I + J → C → E → G → H → F → K`

What holds up:
- **0 first** is right, and it's nearly free now (0.1 done, 0.2 done, only 0.3 docs remain).
- **B1-3 before B4-7** is correct — the foundation genuinely gates the rest.
- **C late** is correct: the Selector (NM-16) is the most valuable and most expensive item, and
  it benefits from intake, thumbnails, and routing trust being solid first.

What I'd change:
1. **A is no longer a wave-sized item.** With the audit corrected, A collapses to: one big
   mechanical job (NM-01 npm scope), one small user-visible fix (NM-02 favicon), a README
   (NM-05), and two deletions. The npm-scope rename is *disruptive to everything else* — it
   should run **alone and early**, or be deliberately deferred to the end. Running it mid-stream
   guarantees merge pain across every other wave.
2. **D (routing trust) should move earlier, near the front.** It's the item you personally hit
   ("we selected Kimi K3 but Claude did the work") — it erodes trust in every other feature, and
   it's independent of everything else. Cheap, high-confidence, parallelizable.
3. **I (thumbnails) is bigger than its position implies** — greenfield, and it shares the capture
   substrate with NM-17 (brand-extraction screenshots) and the already-hardened web-clone
   pipeline. Group those three as one "visual capture" wave rather than scattering them.
4. **J is mostly policy, not code** — Archive exists, the default is already correct. It can ride
   along with any UI wave instead of occupying its own slot.
5. **E (toolbox testing) should not be a late wave.** It's the safety net for everything the
   toolbox touches; the phantom-skill-ID incident already proved that surface can lie. Fold its
   test-harness half early, keep the exhaustive walk-through late.
6. **K1 (route hardening) deserves promotion** out of the trailing cleanup slot — 239 endpoints
   with an SSRF precedent already on the record is a security posture item, not housekeeping.
7. **F and G are small/decision-shaped now** (VoiceBox already has an MCP; memory is a scoping
   call) — they shouldn't occupy full waves.

---

## 6. External capability shortlist (from the GitHub sweep)

Verified live (stars/license/last-push/README claims):

| Repo | License | Maps to | Effort |
|---|---|---|---|
| **dembrandt/dembrandt** | MIT | NM-15 — URL → full design system (colors w/ CSS-var + dark-mode awareness, type, spacing, shadows, `get_brand_identity`); DTCG output; **is itself an MCP server** | Adapter |
| **langfuse/langfuse** | MIT (non-`ee/`) | NM-20 — self-hosted LLM observability with per-project cost roll-up; **the repo already has a Langfuse bridge** | Low |
| **lovell/sharp** | Apache-2.0 | NM-18 — `resize(w,h,{fit:'cover',position:sharp.strategy.attention})` = the hero-crop heuristic | Drop-in |
| **karakeep-app/karakeep** | AGPL-3.0 ⚠ | NM-10/NM-08 — bookmark-everything w/ AI tagging, OCR, full-text search, **Chrome bookmark import** + browser extensions | Adapter (separate service) |
| **rrweb-io/rrweb** | MIT | Clone fidelity — records DOM/scroll mutation streams; inject via Playwright for ground-truth animation timing | Adapter |

⚠ **AGPL note:** Karakeep's network-copyleft triggers on hosting a *modified* Karakeep. Running
it unmodified as a companion service and integrating over its REST API does not affect MishMash's
own licensing. Forking it would.

**Deliberately empty:** multi-reference composition (NM-16) and design-specific embedding search
(NM-09) have **no qualifying OSS** — both are first-party builds. (`clip-retrieval` is dormant;
`marqo`'s own README declares the OSS project deprecated.)

---

## 7. Open disposition — web-clone hardening (this session)

Three commits on `feat/web-clone-capture-hardening` took the clone pipeline through a 3-round
GPT-5.6 adversarial loop. Round 3 verdict: **REJECT**, with ~17 of 22 original findings confirmed
fixed but 6 new HIGH findings.

**The confirmed-fixed set covers every user-facing symptom you reported**: whole-site capture,
query-bearing refs, recursive-fetch fidelity, deterministic width, cleanup, bot-wall detection,
origin classification.

**The 6 new HIGHs split into two classes**, and I want your call rather than an automatic round 4:
- **(A) Real bugs reachable from benign sites** — fragment refs (`sprite.svg#icon`) duplicating
  assets; case-insensitive/Unicode filename collisions on APFS; `ENAMETOOLONG` on long URLs;
  missing standard URL attributes (`object[data]`, `imagesrcset`, `form[action]`); a
  **false-green "Mirror complete"** when recursive discovery exhausts with assets still missing;
  an origin-leak to a *failed* request passing the gate; a malformed baseline `origin` silently
  disabling the origin/global checks. **These warrant one scoped round.**
- **(B) Hostile-input hardening** — symlink write escape, crafted-URL hash non-injectivity,
  hand-edited malicious manifest. This is a **local tool run against sites you choose**;
  I'd document these as known limitations rather than gold-plate them.

Recommendation: one scoped round on class (A) + honest docs for class (B), then land. The
alternative — keep looping — has produced diminishing returns and new findings in new places
three rounds running, which is the classic signal to stop and set a deliberate scope boundary.

---

## 8. Decisions needed from you

1. **NM-03** — internal identifiers (`od`/`OD_*`/`.od/`/`SERVER_NAME`): keep as deliberate, or rename?
2. **NM-01 timing** — run the npm-scope rename early and alone, or defer to the very end?
3. **§7** — scoped round on class (A) then land, as recommended?
4. **NM-24** — Instatic tether shape: MCP + Super Import seam, or deeper?
5. **NM-21** — scope memory to Library embeddings, or evaluate Gemini File Search / Vertex RAG properly?
6. **NM-29/30/31** — the three small carryover rulings (scroll bug, width threshold, worktree deletion).
7. **NM-33** — Kimi Code paid membership: buy, or stay on print-mode?

---

# ADDENDUM — Post-audit corrections (2026-07-26)

Two adversarial audits ran: **Grok 4.5** (prose-only, 26 findings) and **GPT-5.6 Sol**
(repo-access, instructed to spot-check every load-bearing number, 24 findings). Where they
disagree, Sol's verdicts on factual/count claims win — it read the tree. Corrections below
**supersede** the body above.

## C1. Claims in §1 that were WRONG (retracted)

| Was | Correction | Evidence |
|---|---|---|
| **D-11 "no open-design.ai fetch exists"** | **FALSE.** `EntryShell.tsx:228` defaults the onboarding newsletter to `https://open-design.ai/subscribe` — live old-brand network traffic. Provider header `X-Title: Open Design` also active. | Verified directly |
| **D-06 "A3 non-English DONE"** | **Overclaimed.** `clipper/i18n.js` still ships extensive non-English UI dictionaries. Single `en.ts` proves only the *web-app dictionary* was slimmed. Plus ledger residue (`title_i18n`/`description_i18n`, humanize-ppt). | Sol #3 |
| **D-05 "Archive → J2 done"** | Mechanism exists; the **classification pass** (J1 curate / J2 archive-the-rest) is not done. Demote to "plumbing exists". | Grok #2 |
| **D-15 "B6 sweep DONE"** | Self-referential — §6 *is* the sweep. Research done; **integration decisions are not**. Split. | Grok #3 |
| **NM-01 "602 imports / 16 packages"** | **760 imports** (735 declarations + 10 dynamic + 15 import-types; 766 with re-exports) across **563 files**, and **20** workspace manifests. | Sol #4 (AST count) |
| **NM-22 "~239 endpoints / 35 files"** | **340 HTTP method registrations** (334 excl. OPTIONS) across 35 route files, **+6 bootstrap routes** in `server.ts`. | Sol #8 |
| **NM-18 "no screenshot/rasterization pipeline exists"** | **FALSE.** Repo has clipper screenshot capture, Design Browser capture, preview-annotation rasterization, deck thumbnails, and web-clone Playwright. **Real gap:** no persisted project-card thumbnail *field, job, invalidation policy, or renderer*. Reframe as integration + lifecycle, not greenfield. | Sol #12 |
| **NM-07 "6 gated call sites"** | **7 gate expressions across 6 files** — `router.ts` gates twice (route parse + route build). Router tests actively **assert `/library` stays hidden**. | Sol #5/#6 |
| **NM-17 "blocks C1"** | Loss of screenshot *evidence*, not brand-extraction failure. Deterministic HTML/CSS/logo extraction still works; C1 MVP is **not blocked**. `prefetch.ts:940`. | Sol #11, Grok #14 |

## C2. Findings I checked and PARTIALLY REFUTED

- **Cover-iframe threat (Grok #25):** `project-cover.tsx:113` uses `sandbox="allow-scripts"`
  **without** `allow-same-origin` → unique opaque origin; cannot reach parent DOM/cookies/storage.
  Deliberate and documented (`srcdoc.ts:791`, `:1253`). Residual concerns are egress and
  resource-exhaustion from many live frames — real but **perf-tier**, not a security wave.
- **Clipper trust:** Grok called it a trivial privilege path; my check showed bearer auth exists
  and auto-trust covers two bootstrap routes. **Sol went deeper and is right**: pairing/token
  machinery *exists but is bypassed* — any `chrome-extension://`/`moz-extension://` origin is
  accepted for ingest, and loopback calls **without** an `Origin` header bypass browser-origin
  checks. Keep as a real, bounded security item (not "build pairing from scratch" — wire up
  what's already there).

## C3. Structural corrections that change the plan

1. **UI/CLI parity is repo policy and I missed it entirely** (Sol #17). `AGENTS.md` requires every
   user-facing capability to ship through **both** the web UI and the `od` CLI over the same HTTP
   contract (with `--json` / `--prompt-file` where applicable). Every feature wave must carry
   contract + CLI acceptance criteria, not just UI.
2. **Do NOT group NM-17 + NM-18 + web-clone capture** (Sol #13 — reverses my §5 recommendation and
   Grok's agreement). Three different threat models: untrusted *remote* navigation (SSRF/egress),
   trusted *local* rendering (hostile HTML/resource exhaustion), and a capture branch currently
   under a **REJECT** verdict. Separate them; forbid reuse of the web-clone substrate until its
   scoped repair passes independent review.
3. **NM-01 is deferred, not merely isolated** (both auditors, HIGH). `docs/FORK-PIN.md` establishes
   the repo as a hard-pinned fork at `b9f550854` where cherry-picks are the only update lane.
   Renaming 20 packages / 760 imports maximizes conflict surface on **every future upstream pick**
   for near-zero user value. **Default: don't rename internally** (folds into NM-03). If ever done:
   final dedicated wave with compatibility aliases.
4. **NM-13 splits in two** (Sol #10/#23): (a) *locally controllable truthfulness* — persist
   `requested` / `resolved` / `reported` model fields and display
   `verified | unverified | substituted`; (b) *upstream-dependent proof* — execution echoes that
   Codex/Antigravity simply cannot always provide. Ship (a) early; (b) is bounded enhancement.
   Promising "one authoritative badge" is not achievable and should not be a criterion.
5. **NM-16 needs a composition IR + eval corpus before any generator** (both auditors, HIGH).
   Missing: reference-addressing model, breakpoint/state selection, conflict policy, provenance
   map, and a definition of *structural* (not cosmetic) variant diversity. "User picks one"
   measures preference, not fidelity. Scored eval axes: layout geometry, palette/type fidelity,
   motion timing, section identity, responsiveness, broken assets, a11y, **source bleed**.
6. **NM-22 is not one wave** (Sol #9). Split by threat boundary — agent spawn, filesystem R/W,
   deploy, external fetch, Library ingest, imports — highest-risk tranches **before** Library
   exposure or capture work; long-tail route review after.
7. **Scale is a real risk, unregistered** (Sol #14). `DesignsTab` fans out live-artifact and
   file-list requests via **unbounded `Promise.all`** across every project, then mounts live
   preview iframes — against a **987 MB** project store. Needs benchmark → pagination/
   virtualization → bounded concurrency → stored covers → budgets.

## C4. Consolidated new items (merged from both auditors, deduplicated)

| ID | Scope |
|---|---|
| **NM-35** | Land web-clone hardening: fix §7 class-(A) HIGHs, document class-(B) limits, merge the branch |
| **NM-36** | Privileged-daemon threat model: caller classes, capability tokens (wire the existing bypassed machinery), CORS/CSRF/DNS-rebinding, high-risk endpoint tests |
| **NM-37** | Full backup/restore: atomic snapshot + restore-to-fresh-root for SQLite, projects, Library, memory, config; integrity + secret-exclusion tests |
| **NM-38** | Rebrand/data compatibility suite: open + migrate pre-MishMash data/config/project/MCP fixtures, with rollback (a legacy data-dir copier already exists to build on) |
| **NM-39** | Scale budgets: benchmark the 987 MB store; startup/listing/search/thumbnail/memory/disk limits; fix unbounded `Promise.all` fan-out |
| **NM-40** | Error/degraded/offline UX: distinguish empty vs loading vs daemon-down vs storage-error vs model-offline vs partial-success (APIs currently collapse failures to `[]`/`null` → "no projects" when the daemon is down) |
| **NM-41** | Accessibility release gate: axe + keyboard/focus + SR naming + contrast + reduced-motion + zoom/reflow, per UI wave |
| **NM-42** | Capture isolation service: separate trusted local rendering from untrusted remote navigation; queues, limits, egress policy, provenance |
| **NM-43** | Selector composition IR + eval corpus (spike only — no generator) |
| **NM-44** | AI data lifecycle: consent, local-vs-remote routing, retention, deletion propagation, embedding versioning/reindex, spend caps — **prerequisite for NM-08/09** |
| **NM-45** | Reference rights/provenance: record source URL/time/licence for captured references; prevent untraceable redistribution |
| **NM-46** | Fork maintenance cadence: cherry-pick conflict playbook, compatibility aliases, upstream security picks, divergence-cost tracking |
| **NM-47** | Onboarding integration for newly exposed surfaces (Library, Client Website, Selector) incl. failure recovery |
| **NM-48** | UI/CLI parity acceptance harness — assert every new capability ships in web UI **and** `od` CLI over the same contract |
| **NM-49** | deepseek CLI PATH hygiene, or explicit won't-fix |

## C5. Both auditors independently agreed on

Defer NM-01; NM-07 is a release-readiness epic not a flag flip; NM-16 needs IR + eval before
implementation; NM-13 needs a schema before UI; NM-22 must be split by threat boundary; and the
register was missing backup/restore, migration compatibility, threat model, a11y, error states,
scale budgets, onboarding, and fork cadence. **Convergent findings from two independent
adversaries are treated as settled, not opinions.**
