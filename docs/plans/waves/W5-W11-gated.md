# Waves 5, 6, 8, 9, 10, 11 — gated waves (PRD skeletons)

These waves are gated behind earlier ones. Each skeleton carries scope, the audit findings that
shape it, and its success-criteria spine. Detailed criteria are deliberately **not** written yet —
their earlier gates will change what they need, and writing acceptance criteria now for work that
starts after four other waves would be planning fiction.

## ⚠️ The expansion gate (added in revision 2 — this is blocking)

Sol raised this as a blocking item and it is the correct catch: **a skeleton handed to an
autonomous agent is an invitation to self-certification.** The agent writes its own acceptance
criteria *after* seeing its own implementation, then passes them. Everything about the criteria
being gameable stops mattering when the agent authors the criteria.

So expansion is a **separate, independently reviewed step**, not the first move of implementation:

1. When a wave's gates clear, expand its skeleton into a full PRD — criteria, verifier, leases.
2. That PRD goes through adversarial review **on its own**, by a reviewer that will not implement it.
3. The PRD and its `scripts/waves/verify-<wave>.ts` are **frozen and committed** before any
   implementation work begins.
4. Only then does the wave's `/goal` run start.

An agent may not begin implementation from the text on this page. Doing so is a hard reject.

---

## Wave 5 — Library usefulness

**Slug:** `mishmash-w5-library-usefulness` · **Gates on:** W3 **and W1** ·
**Loop:** `loop:red-green-review`

> **Gate correction:** the first draft gated W5 on W3 alone while its own criteria spine required
> capped, visible spend — which is W1's meter. If W1 lags, W5 ships **uncapped** AI enrichment over
> a private reference library. W1 is now a hard gate, not a cross-reference.

**NM-24C first — the data-lifecycle contract is a hard prerequisite.** Both auditors flagged that
AI enrichment was registered without consent, routing, retention, deletion-propagation,
embedding-versioning, reindexing, or spend controls. Automatic enrichment of a user's private
reference library without that contract is the kind of thing you cannot un-ship. Define it, then
build on it.

Then: **NM-08** enrichment (caption/OCR — `library.ts` currently records
`skipped: ai: caption/ocr/embedding skipped (no model configured)`); **NM-09** light up the
dormant `library_embeddings` table (`asset_id, model, dim, vector BLOB, indexed_text` — schema
exists, zero referencing code) with generation + similarity query + search UI; **NM-10** Chrome
bookmark import (first-party HTML-export parse MVP; Karakeep remains an option but is AGPL and a
second service for a local-first product); **NM-30C** reference rights/provenance (source URL,
timestamp, licence) so captured references are traceable; **NM-12** tests + docs.

**Criteria spine:** deletion propagates to embeddings; re-index is versioned and resumable; spend
is capped and visible (ties to W1's meter); local-vs-remote processing is a user choice; search
returns provenance; bookmark import round-trips title/description/URL; UI/CLI parity.

---

## Wave 6 — split into W6a and W6b

Both reviewers found the same defect: this was **secretly two waves**, and the phrase "capture
service (if built)" let an agent skip the entire capture half and still declare the wave complete —
while the wave's own title promised it. The two halves also have **different threat models**, which
operating rule 2 forbids sharing a substrate. Split:

### Wave 6a — Client Website, guided flow

**Slug:** `mishmash-w6a-client-website` · **Gates on:** W2, W4 · **Loop:** `loop:red-green-review`

**NM-15 — the primitives already exist**, which the backlog did not know: `apps/daemon/src/brands/`
(96 KB + `engine/{build,derive,kit,palette,seed,types}.ts`) does URL → prefetch → seed → derive →
`DesignTokens` → themed kit + artifacts, **deterministically, no LLM**; `brand-routes.ts` exposes
the full lifecycle; design-system **apply** is already an instrumented action. The work is one
guided `ProjectKind: 'client-website'` chaining extract → confirm → apply-to-reference, plus
document/upload-based token entry (the backlog asks for "from their documents", not only from a URL).

**Criteria spine:** guided flow completes end-to-end from a real client URL; tokens applied to a
chosen reference; document and upload paths each work with rollback on a failed apply; UI/CLI
parity. **No capture work here** — W6a is complete without a screenshot.

### Wave 6b — Remote capture isolation

**Slug:** `mishmash-w6b-capture-isolation` · **Gates on:** **W-C landed** + **W9's external-fetch
tranche green** · **Loop:** `loop:red-green-review`

**NM-22C + NM-17.** `brands/prefetch.ts:940` hardcodes `screenshot = null` after an SSRF-prone
Chrome path was removed. Restoring it means a capture isolation service: egress policy/allowlist,
queue and resource limits, provenance. It **must not** reuse W4's local renderer (different threat
model) and **must not** reuse the web-clone substrate until W-C has landed and been independently
reviewed. The first draft asserted this dependency in prose but wired no gate — so an agent could
have built a parallel SSRF-prone Playwright path and satisfied every criterion.

**Criteria spine:** red specs for redirect-based SSRF, DNS rebinding, worker- and iframe-initiated
egress, and internal-address ranges; queue depth and resource limits enforced; provenance captured
per fetch; W-C and W9 prerequisite receipts recorded in the manifest.

**C1's MVP is NOT blocked on any of this.** Deterministic HTML/CSS/logo extraction works today;
screenshots are a quality upgrade. W6a ships first and independently.

---

## Wave 8 — Selector build

**Slug:** `mishmash-w8-selector-build` · **Gates on:** W7 (both reviewers signed off), **W4, W3** ·
**Loop:** `loop:eval-gate`

> **Gate correction:** the first draft gated W8 on full W5, which is both too much and too little.
> Too much: it delays the flagship behind AGPL-adjacent bookmark import and enrichment it does not
> need. Too little: W8's advertised "1–4 references (URL, library, or upload)" needs a **safe
> URL → pinned snapshot** producer, and W7 explicitly excludes capture. Either a reviewed
> `ReferenceSnapshot` acquisition contract lands first (via W6b), **or W8's scope narrows to
> Library and upload inputs** and the URL flow is cut from its claims. Decide before starting; do
> not discover it mid-wave.

Implement the composition IR from W7 into a working Selector: references → directives → 3
structurally-distinct prototype variants → selection becomes the project template. **Every change
is accepted or rejected by the W7 eval gate**, never by taste alone.

**Criteria spine:** every corpus case runs; scores meet W7's **absolute floors** on the held-out
split, not only on the cases W8 could see; `directive_claim_coverage` clears its floor; source
bleed below tolerance; the 3 variants pass the pre-registered structural-diversity metric;
provenance queryable for any output element; a directive naming a nonexistent element fails
gracefully; UI/CLI parity.

**Immutability:** W8 may not edit W7's thresholds, scorer, corpus, or seal. A threshold change
requires a founder decision record. The scorer version is pinned in every eval manifest.

**Stop rule:** if the eval gate cannot be satisfied after two honest attempts, the finding is that
the IR is wrong — return to W7. Do not lower the thresholds.

---

## Wave 9 — Route hardening tranches

**Slug:** `mishmash-w9-route-hardening` · **Gates on:** W0 · **Loop:** `loop:tranche` · **Rolling**

Sol: "NM-22 is not executable as one 'harden all routes' wave." Real surface is **340 HTTP method
registrations** (334 excluding OPTIONS) across 35 route files, **plus 6 bootstrap routes** in
`server.ts` — not the ~239 the assessment claimed.

Order by threat boundary, highest risk first: **agent spawn** → **filesystem read/write** →
**deploy (BYOK tokens)** → **external fetch (SSRF — there is precedent in this repo)** →
**Library ingest** (must precede W3's exposure) → **imports** → long tail.

The **Library ingest tranche is a hard gate on W3** — recorded as its own slug
(`mishmash-w9-ingest-tranche`) so it can be executed in Burst 3 beside W4 and referenced as a
completed prerequisite, rather than living inside a "rolling" wave that W3 could outrun.

Each tranche produces an ownership matrix row per endpoint and a per-tranche report. **Never emit
"we hardened everything"** — emit what was attributed and what remains.

> **"Attributed" has a definition** (`VERIFICATION-CONTRACT.md` §6). A row counts only with
> `{owner, authn, authz, input-validation, size/rate limit, test-ref}` populated. A matrix full of
> `auth:none, validation:none` rows is **not** a completed tranche — it is a documented inventory
> of known-vulnerable endpoints. Each such row needs either a control or a **founder-signed
> accepted-risk entry naming who accepted it**.

**Criteria spine:** route snapshot frozen with drift detection; risk-ranking rule stated, not
improvised; matrix mechanically generated; endpoint tests per tranche; adversarial verification
per tranche; unattributed endpoints visible and counted, never silently assumed safe.

---

## Wave 10 — Integration tail (**splits by capability**)

**Loop:** `loop:red-green-review`

> **Gate correction:** the first draft gated the whole tail on W1 + W3, but its onboarding item
> covers Client Website and Selector — which **do not exist** until W6a/W8. These are also
> unrelated execution units with independent founder decisions, so one wave with one gate cannot
> hold them. Each slice is its own run with its own gate:
>
> | Slice | Slug | Gates on |
> |---|---|---|
> | Instatic tether (NM-24) | `w10a-instatic` | founder ruling |
> | VoiceBox (NM-25) | `w10b-voicebox` | founder ruling |
> | Toolbox reliability (NM-19) | `w10c-toolbox` | W0 |
> | Gallery/archive taxonomy (NM-27) | `w10d-taxonomy` | W3 |
> | Memory scope (NM-21) | `w10e-memory` | founder ruling |
> | Storage retention (NM-36C) | `w10f-storage` | W0 |
> | Onboarding (NM-32C) | `w10g-onboarding` | **W6a, W8** |

**NM-36C — storage retention.** `.tmp` at 30 GB, e2e artifacts, and `.od` growth need a retention
policy and GC. This item had no home in the first draft and would have been silently dropped.

**NM-24 Instatic** — zero repo references today. Recommended seam: its **MCP server** + **Super
Import** (static zip → pages/tokens/media). MishMash produces a static site; Instatic imports it
as a CMS-backed site. Bun-only (`engines.bun >=1.3.0 <1.4.0`) — it stays a companion service, not
a dependency. Founder ruling on depth needed.

**NM-25 VoiceBox** — already ships an MCP server (HTTP `127.0.0.1:17493/mcp`, tool
`voicebox.speak`, plus a stdio binary). Registering it is trivial; the real question is *product
shape* — a `speak` tool with no studio UX adds a tool, not a capability. Either scope
"design-workflow voiceover" (script → timed track → merge into a video project, relating to the
existing ElevenLabs/FishAudio/SenseAudio BYOK lanes) or cut the item honestly.

**NM-19 toolbox exhaustive walk** — all 16 actions end-to-end from the side panel, table-driven
against **real skill IDs** (a phantom ID must fail the test), with action→skill mapping assertions
moved into the daemon suite. Today only a repo-root guard exists, and a prior run found **17
phantom skill IDs** — this surface has lied before, so "exhaustive" needs a per-action row, not a
adjective.

**NM-27 J-policy** — J1/J2 are a *classification pass* (Archive plumbing already exists); J3 renames
the `pluginsHome.title: 'Community'` heading on the plugin/template gallery; J4 groups media-task
entry points (note: **HyperFrames is a media provider/model**, not a design-system category).

**NM-21 memory scope** — recommendation: scope to the Library-embeddings use case rather than
replacing a working markdown two-loop chat-memory system. Resolve the "OKF" question (Gemini File
Search vs Vertex AI RAG Engine) only if the founder wants managed RAG.

**NM-32C onboarding** (slice `w10g`, gates on W6a + W8) — extend onboarding for the newly exposed
surfaces (Library, Client Website, Selector) including failure recovery. Cannot start before the
surfaces it onboards exist.

---

## Wave 11 — Namespace & fork ops (DEFERRED BY DEFAULT)

**Slug:** `mishmash-w11-namespace` · **Gates on:** all feature waves · **Default: do not run**

**NM-01** — rename `@open-design/*`: **20 workspace manifests, 760 imports across 563 files**
(735 declarations + 10 dynamic + 15 import-types; 766 with re-exports). Sol's AST count; the
assessment's "602 across 16" was wrong.

**Both auditors returned HIGH findings against doing this at all.** `docs/FORK-PIN.md` establishes
the repo as a hard-pinned fork at `b9f550854` where **cherry-picks are the only update lane**.
Renaming the namespace maximizes conflict surface on essentially every future upstream pick, for
near-zero user-visible value — the user-visible brand tail is already handled in W2.

**Default recommendation: don't.** Record it as a deliberate decision (W2's C2-10 doc). If the
founder overrides, this runs **last**, alone, with compatibility aliases, executing the migration
mapped by **NM-26C** — whose *inventory* half W0 already froze, precisely so the blast radius is
known before anyone commits to this.

**Non-negotiable if it ever runs:** W0's backup/restore proven working first; pre-MishMash fixture
open + migrate + **rollback** tests green; compatibility-alias smoke tests green; and an upstream
cherry-pick conflict rehearsal against `b9f550854` completed — because maximizing conflict surface
on the only update lane this fork has is the actual cost, and it should be measured, not assumed.
