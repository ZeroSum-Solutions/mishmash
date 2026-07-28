# Canonical NM register — the single source of item IDs

**This file is authoritative.** Where it disagrees with the assessment body, either auditor's raw
output, or any wave PRD, **this file wins**.

## Why this file exists

Three documents independently proposed IDs in the NM-35..NM-49 range: Grok 4.5's audit, GPT-5.6
Sol's audit, and the assessment's merged addendum. **None of the three numbering schemes match.**
A literal agent reading an auditor's raw output alongside a wave PRD would implement the wrong
item — e.g. "NM-38" means *rebrand compatibility* here, *cover-iframe security* in Grok's audit,
and *scale budgets* in Sol's.

**Rule for every agent:** cite IDs from this file only. Treat NM numbers appearing in
`../../scratchpad` audit outputs or in audit prose as *that auditor's local numbering*, not as
register IDs.

## Register

### From the original backlog note (NM-01 … NM-34)

| ID | Item | Wave | Status |
|---|---|---|---|
| NM-01 | Rename `@open-design/*` scope (20 manifests, 760 imports, 563 files) | W11 | **Deferred by default** — both auditors HIGH against |
| NM-02 | Stale PNG brand assets (favicon + apple-touch-icon) | W2 | Open |
| NM-03 | Internal-identifier policy ruling (`od`, `OD_*`, `.od/`, `SERVER_NAME`) | W2 | **Resolved 2026-07-27** — KEEP internal identifiers + `@open-design` package scope (with NM-01). W11 will not fire. C0-12 inventory still runs, inventory-only |
| NM-04 | Orphaned Chinese i18n key + toolbox `searchTerms` | W2 | Open |
| NM-05 | README rebrand | W2 | Open |
| NM-06 | Retire `open-design-public-metadata` route | W2 | Open |
| NM-07 | Library dark-launch readiness (7 gates / 6 files) | W3 | Open — **epic, not a flag flip** |
| NM-08 | Library AI enrichment (caption/OCR) | W5 | Gated on NM-24C |
| NM-09 | Light up `library_embeddings` | W5 | Gated on NM-24C |
| NM-10 | Chrome bookmark import | W5 | Open |
| NM-11 | Wire skills/design-files/repos into intake | W5 | Scope after NM-07 |
| NM-12 | Test + document the wired intake surface | W5 | Open |
| NM-13 | Picker/executor mismatch — **splits into 13a/13b/13c** | W1 | Open |
| NM-13a | Schema: `requested`/`resolved`/`reported` + display state | W1 | Open |
| NM-13b | Surface substitution visibly; extend correction beyond `amr` | W1 | Open |
| NM-13c | Antigravity honesty (serialize or mark unverified) | W1 | Open |
| NM-14 | Gemini lane decision (D5 as written is obsolete) | W1 | Founder decision |
| NM-15 | "Create Client Website" project type | **W6a** | Open |
| NM-16 | Mishmash Selector (build) | W8 | Gated on NM-23C |
| NM-17 | Restore brand-extraction screenshot input | **W6b** | Gated on NM-22C |
| NM-18 | Project-card cover lifecycle (**not** greenfield capture) | W4 | Open |
| NM-19 | Design-toolbox reliability + 16-action mapping tests | **W10c** | Open |
| NM-20 | Cost & usage meter (in-app first) | W1 | Open |
| NM-21 | Memory scope decision | **W10e** | **Resolved 2026-07-27** — library embeddings only |
| NM-22 | Route hardening (340 registrations + 6 bootstrap) | W9 | **Split by threat boundary**; ingest tranche is its own gate on W3 |
| NM-23 | Second de-bloat pass (`tools/pack`, `.tmp` 30 GB, `.od` 1.1 GB) | **W10f** | Open |
| NM-24 | Instatic tether | **W10a** | **Resolved 2026-07-27** — seam = MCP + Super Import only; W10a pinned to that seam; deeper coupling needs separate evidence |
| NM-25 | VoiceBox MCP tether (MCP already exists) | **W10b** | **Resolved 2026-07-27** — register the MCP and stop; W10b shrinks to registration only |
| NM-26 | Documentation honesty (mark archived in-file) | W2 | Open |
| NM-27 | Library/gallery organization policy (J1–J4) | **W10d** | Open |
| NM-28 | Current daemon failure inventory (re-measure) | W0 | Open |
| NM-29 | Frozen `t4-scroll` scroll-speed bug | — | Founder decision |
| NM-30 | Mirror-width threshold deviation override | — | Founder decision |
| NM-31 | `od2-debloat` worktree deletion | — | Founder decision |
| NM-32 | Motion-library adoption backlog | — | Deferred (ADR one-at-a-time) |
| NM-33 | Kimi ACP membership + silent-success guard | W1 | Founder decision + guard |
| NM-34 | Higgsfield Settings→Media depth | — | Deferred |

### Audit-derived items — renumbered as NM-nnC to end the collision

The `C` suffix means "consolidated from audits." These IDs are **new and unambiguous**; they do
not collide with either auditor's local numbering.

| ID | Item | Wave | Source |
|---|---|---|---|
| NM-20C | Land web-clone hardening (class-A fixes + honest limits) | W-C | Both |
| NM-21C | Privileged-daemon threat model + wire the bypassed capability tokens | W0 | Both |
| NM-22C | Capture isolation service (untrusted remote navigation) | **W6b** | Sol |
| NM-23C | Selector composition IR + eval corpus + grader | W7 | Both |
| NM-24C | AI data lifecycle (consent, routing, retention, deletion, versioning, spend) | W5 | Sol |
| NM-25C | Full backup / restore / disaster recovery | W0 | Sol |
| NM-26C | Rebrand + stored-data compatibility inventory and migration map | W0 (inventory) → W11 (execution) | Both |
| NM-27C | Scale budgets + unbounded `Promise.all` fan-out fix | W0 (measure) → W4 (fix) | Sol |
| NM-28C | Error / degraded / offline state taxonomy | W3 (Library slice), W1 (routing slice) | Sol |
| NM-29C | Accessibility release gate | W3, W4, W1 (per-surface slices) | Sol |
| NM-30C | Reference rights / provenance capture | W5 | Sol |
| NM-31C | Fork maintenance cadence (cherry-pick playbook, alias inventory) | W2 (lightweight doc) | Both |
| NM-32C | Onboarding integration for newly exposed surfaces | **W10g** (gates W6a + W8) | Both |
| NM-33C | UI/CLI parity harness (repo policy enforcement) | W0 | Sol |
| NM-34C | Daemon residual de-brand (share-helpers, `pluginFolderActions`, sidecar handshake) | W2 | Grok |
| NM-35C | Cover-iframe sandbox contract freeze + documented threat | W4 | Grok |
| NM-36C | Storage retention policy (`.tmp` 30 GB, e2e artifacts, `.od` growth) | **W10f** | Grok |
| NM-37C | deepseek CLI PATH hygiene, or explicit won't-fix | W1 | Both |

### Added in revision 2 (second review round, wave plan)

| ID | Item | Wave | Source |
|---|---|---|---|
| NM-38C | Per-wave verifiers + commit-bound proof manifests (`scripts/waves/`) | **all** | Both — the top blocking finding |
| NM-39C | Mechanical write leases (`leases.json`) + one integrating writer | **all** | Both |
| NM-40C | `directive_claim_coverage` axis + counterfactual + held-out corpus split | W7 | Both |
| NM-41C | Independently-reviewed PRD-expansion gate for W5–W11 | W5–W11 | Sol |
| NM-42C | Safe `ReferenceSnapshot` acquisition contract, or narrow W8 to Library/upload | W8 | Sol |

## Items that were dropped, and why

| Proposed | Disposition |
|---|---|
| Grok's "cover-iframe security fix" | **Partially refuted.** `project-cover.tsx:113` sets `sandbox="allow-scripts"` **without** `allow-same-origin` → unique opaque origin; parent DOM/cookies/storage unreachable, deliberately (`srcdoc.ts:791`, `:1253`). Residual egress/resource concerns retained as **NM-35C** (contract freeze + documentation), not as a fix |
| "term agreements" (backlog open question) | No matching surface found. Waived explicitly; reopen only if the founder recalls the intent |
| MishMatch open items (inquiry-capture endpoint, LangSmith sandbox tracing, D11 amendment, Sol-verdict waiver, F9 record authenticity) | **Different product** (`zs-acquisition-engine`/`zs-crm`/`zs-workbench`). Not MishMash's backlog |
