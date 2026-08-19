# Cross-Cutting Corrections — Demo Findings F001-F011

**Six** finding PRDs (F001, F002, F004, F005, F006, F007) were audited by GPT-5.6-sol at high
reasoning effort against the live repo, and every one of the six came back NOT-READY with real
errors. **F003, F008, F009 and F010 were never audited by GPT-5.6** — a fan-out guard blocked
the model lane — so they were instead self-verified by the repair pass against the same
checklist, which is a weaker check. **F011 was audited and repaired separately.** Treat the
four self-verified findings as less thoroughly checked than the six, and run their audits
(Lane 0 in the RUNBOOK) before trusting them. The same five failure modes showed up across almost every
finding, which means they were systemic to how these PRDs got written, not one-off mistakes:

1. **Dual-track CLI closure skipped.** Requirements described a web change and stopped, with
   no HTTP endpoint, contracts DTO, or `od` CLI subcommand named — a repo-wide rule (AGENTS.md)
   every finding is supposed to satisfy.
2. **Wrong Playwright paths.** Nearly every original verify command pointed at
   `e2e/specs/*.spec.ts`, which is the Vitest tree. The real Playwright tree is flat
   `e2e/ui/*.test.ts` importing from `@/playwright/suite`. This alone would have made every
   affected finding's "done" check silently no-op.
3. **Human-judgment success criteria.** Bars like "a human reviews the output and agrees" or
   "two people watch two browser windows" cannot pass unattended and were rewritten as
   automated oracles, with the genuine taste/judgment calls moved to a non-blocking morning
   review list.
4. **Unverified or stale counts.** Template counts, test counts, DB row counts, and coverage
   percentages were asserted without a re-run command, and several were flat wrong (352 vs
   353 templates, 316 vs 306 typeface dirs, 284 vs 241 passing tests, etc.).
5. **Duplicated existing capability.** Several findings proposed building a new endpoint,
   registry, or realtime channel that already exists in a different file than the one the
   author checked — the corrected PRDs extend the real thing instead of building a rival.

**Bottom line: three of the ten findings (F001, F007, F010) are not ready for an unattended
run tonight — each has an unresolved architecture or legal-authorization decision that blocks
its core requirements, not just a nice-to-have.** The other seven are ready, several only
after the repair pass rewrote scope, decisions, or the reference PRD out from under them.

## Ready-for-unattended-run status

| Finding | Ready tonight | What still blocks it |
|---|---|---|
| F001 | **No** | GenUI invocation architecture undecided (blocks R7's live-chat half + success criterion 5); coverage bar undecided (measured 54%/24% vs a stated 85% target, blocks success criterion 2) |
| F002 | Yes | P0 (R1-R7) has no open decision. Four decisions exist but only gate P1/P2 (hosting boundary, variant semantics, quick-tier UX, embed audience) |
| F003 | Yes | P0-P2 has no open decision. Two decisions exist but only gate future phases (turn concurrency, client-facing access) |
| F004 | Yes | No blocking decision. One root-cause question is explicitly filed as a non-blocking follow-up |
| F005 | Yes | P0 has no open decision. P1 (R10-R12) is blocked on F003's shared-daemon-vs-multi-tenant call and is explicitly out of tonight's scope |
| F006 | Yes | R1-R6 have no open decision. R7 onward needs Devin to pick which 5 real artifacts to validate against (the originally-named example project doesn't qualify) |
| F007 | **No** | Six DECISION REQUIRED items (section vocabulary, Style curation, Theme thresholds, Mood/Density/Motion vocab — none exist yet, live/live-artifacts merge, R15 interop design) block the section-facet half of P0; that half is also hard-gated on F001 landing first |
| F008 | Yes | P0 has no open decision. The one F001-dependent P1 bullet is explicitly deferred (F001 doesn't exist yet) |
| F009 | Yes | Main build has no blocking decision. Two decisions exist (rights source for 7 blocked items, live-preview sandboxing tradeoff) but the PRD ships a non-regressive default and proceeds independently of both |
| F010 | **No** | Two DECISION REQUIRED items block R1-R5/R9 entirely: whether the 19 new UI8 collections can be marked licensed on account-token match alone, and whether committing an adapted UI8 code kit into the public git-tracked catalogue is legal under RIGHTS.md at all |

## Decisions required (read this in the morning)

Deduplicated across all ten findings, grouped by what they actually are. Each blocks a named
requirement — nothing here blocks a whole finding unless stated.

**Architecture**

1. **Client-facing hosting boundary.** Does client-facing access (the F002 interview link, the
   F003 "can a client ever see a project" question) stay on the existing loopback-bound shared
   daemon, or does it need a genuinely separate hosted trust boundary? Blocks F002 R8/R9/R10
   directly; blocks F003's future client-facing phase; blocks F005 P1 (R10-R12) transitively
   through F003.
2. **GenUI invocation for a chat-agent-triggered surface.** F001's advisor needs to open a
   gallery-select GenUI surface from a chat tool call. Every existing GenUI request goes
   through the plugin-pipeline system with a real `pluginSnapshotId` — there's no precedent for
   a non-plugin caller. Wrap the advisor as a plugin (reuses proven machinery, forces plugin
   lifecycle) or generalize `requestSurface` to accept a non-plugin origin (core-subsystem
   change)? Blocks F001 R7's live-chat half and success criterion 5.
3. **Concurrent-turn handling.** Should the daemon queue/lock turns or allow interleaving when
   two members prompt the same conversation at once? Blocks a future F003 concurrency phase
   only, not P0-P2.

**Coverage / measurement bars**

4. **F001's confidence-coverage gate.** Ship P0 reporting the true measured palette/typography
   coverage (54%/24%, measured tonight) with no fixed percentage gate, or pull F001 R15's
   rendered-page sampling forward from P2 to raise real coverage first? Blocks F001 success
   criterion 2's specific bar, not index-building itself.

**Product/UX decisions**

5. **Interview variant semantics.** How many is "a couple" for F002 R12, and do variants differ
   by F001 direction or by copy? Also decides whether R12 reuses
   `GuidedCreateBrief.iterations` or adds a new field. Blocks F002 R12.
6. **Quick-tier auto-upgrade.** Should F002's quick tier offer to keep going when the client is
   engaged? Blocks only that UX detail, not the rest of P1.
7. **Embed default audience.** Is the default audience of F002's embed the MishMash client's
   own customers, or the client themselves? Affects copy and possibly the auth model. Blocks
   F002 R11.
8. **External-platform naming.** Should F001's advisor ever name external site-builder
   platforms (Squarespace, Ghost, etc.), or stay MishMash-only? P0-non-blocking; a safe default
   (omit) is already specified.
9. **Vela/AMR integration scope.** F005 cuts only the message-center leak. Should the rest of
   the Vela/AMR integration (login, wallet/billing, model catalog) also stop talking to the
   vendor? Devin's call; does not block F005 P0.

**F006 — critique jury**

10. **Which 5 real artifacts to validate against.** The originally-named example project
    (Alex Roth Ceramics) doesn't exist in the local DB and the closest-named project fails the
    real eligibility gate. Eligibility must be discovered empirically at runtime. Blocks F006
    R7 onward, not R1-R6.
11. **Jury rollout cadence.** Should the critique jury eventually run on every build or only on
    request (the M1→M2→M3 question)? Deferred to morning review; doesn't block tonight.

**F007 — filter/section facets (none of this vocabulary exists yet)**

12. **`grid` as a ratified Section value.** 10 real token-matched templates support it, but it's
    unratified. Blocks the final R7 vocabulary.
13. **Style descriptor curation.** Who curates the ~25-30 Style descriptor subset out of 151
    `design-systems/` entries, and by what criteria versus brand-imitation entries? Blocks the
    Style facet.
14. **Theme luminance thresholds.** Thresholds and precedence among light/dark/warm-paper/
    high-contrast are unset (a reusable `luminance()` reference implementation exists but has
    no thresholds wired to it). Blocks the Theme facet.
15. **Mood/Density/Motion vocabularies.** None of these three exist anywhere in the repo yet —
    no adjective list, no measurement algorithm. Blocks all three facets.
16. **`live` vs `live-artifacts` scenario merge.** `ExamplesTab.tsx:105` hardcodes
    `scenario === 'live'` today, so unifying these is a behavior change, not formatting. Blocks
    full R16.
17. **R15 advisor↔filter interop.** No DTO, endpoint, or acceptance scenario exists for this
    yet. Explicitly deferred out of P0; needs its own spec pass.

**F009 — asset rights**

18. **Rights source for 6 blocked library items + Generated Icons provenance.** Which
    license/source covers 3 UI8 kits, 2 icon sets, and 1 Design Inspiration item; is Generated
    Icons confirmed own-code? Genuinely needs Devin's word — not derivable from the repo.
19. **Live-preview sandboxing tradeoff.** Broaden the unsandboxed raw-file-open preview route
    to all 277 catalog items (real script/tracker-execution exposure), keep it narrowly scoped
    as a named exception (the PRD's shipped default), or migrate it to the already-sandboxed
    mechanism? A security/product tradeoff, not a documentation gap.

**F010 — UI8 kit ingestion (blocks the finding entirely, not just a sub-requirement)**

20. **Licensed-source-review authorization for 19 new UI8 collections.** Does an account-token
    match alone authorize marking them licensed, or does each need Devin's individual
    confirmation? Blocks R2/R5/R9 and success criteria 1/3/4.
21. **Code-kit redistribution legality.** Is committing an adapted UI8 code kit into the
    git-tracked, public `design-templates/` catalogue a permitted "adaptation into an
    end-product" under RIGHTS.md, or forbidden "redistribution of source"? Blocks R1-R4
    entirely.
22. **fushion's real identity.** Its payload is a full git history with a `.vercel/` deploy
    folder and commits referencing a "ToolsGrid" component and PBKDF2 auth — reads like a
    deployed SaaS codebase, not a UI8 marketplace kit. Worth Devin's eyes before it's treated
    as a template candidate at all.

**Provisional, not formally resolved (low priority, not blocking)**

- F001's result-count cap defaults to 12 (Devin's own suggested number) but isn't formally
  locked.
- F001's Refero weighting (P1) is unresolved but doesn't block P0.
- F003's shared-daemon-vs-multi-tenant choice is running tonight on the original draft's own
  recommendation (shared-daemon), flagged for explicit morning sign-off, not silently final.

## Safe to build tonight

Only these findings/phases are fully machine-verifiable with no open decision in the way:

- **F011 — the entire finding (P0-P2), and it should go FIRST.** Audited and repaired
  separately on 2026-08-18. No decision turned out to be unmade. Effort raised S→M: the fix has
  three independent consumers, not one — `resolveCanvasFile`
  (`apps/daemon/src/projects.ts:234-251`, the documented single source of truth), plus two that
  bypass it and would keep serving the shim: `getArtifact` (`apps/daemon/src/mcp.ts:1645`) and
  `chooseExportManifestEntryFile` (`apps/daemon/src/routes/import-export-routes.ts:1446-1454`).
  It is a pure read-path fix — no migration script needed. Its original success criterion 2
  ("real site painted, not blank") had NO requirement that tested rendering at all; a Playwright
  test (R1b) at `e2e/ui/` was added to actually close it.

- **F002** — all of P0 (R1-R7).
- **F003** — all of P0-P2.
- **F004** — the entire finding (R1, R2, R3, R5; R4 was deleted as contradicting its own
  success criterion).
- **F005** — all of P0 (R1-R9). P1 (R10-R12) is out of scope, gated on F003's decision.
- **F006** — R1-R6 (contract field, CLI subcommand, concurrency cap, cost tracking, machine
  oracles). R7 onward is gated on picking real validation artifacts.
- **F008** — all of P0 (R1-R8, i18n key, cache-control fix). The one F001-dependent P1 bullet
  is out of scope.
- **F009** — the main build (R1, R3, R4, R5, the non-regressive default for R6/R7, R8, R11,
  R12). Only the two named decision-gated pieces (which of the 7 items get unblocked; whether
  to broaden past the safe default) are held back.
- **F010, Phase 1 only** — vocabulary population limited to `od.category`/`od.scenario`,
  node_modules/.git stripping, nested-archive unzipping, render-checks. Phase 2 (everything
  that depends on the two rights decisions) does not run tonight.
- **F007, P0-A only** (filter-primitive standardization/consolidation into
  `packages/components`). P0-B (the new section facet) is hard-blocked on F001 landing plus
  six vocabulary decisions and does not run tonight.
- **F001, partially** — index building (R1/R2), the single fully-specified `poetry` archetype
  (R3), the matchCatalogue extension (R4), the mood taxonomy addition (R5), the
  design-advisor recommend endpoint (R6), the CreateProjectRequest extension (R8/R8a), token
  storage (R10), and Refero rights routing (R11) are all buildable and testable tonight. Only
  R7's live-chat GenUI invocation and the final coverage pass/fail bar are held back — build
  everything else, but F001 as a whole does not clear its own success criteria unattended.
