# MishMash — Team Demo Findings Log (2026-08-18)

Running log of findings, gaps, and ideas captured live during the team demo.
Devin drops raw notes in any order; each becomes a numbered finding with a PRD
detailed enough for an **unattended overnight implementation run**.

**No code changes are made when a note is captured.** Capture and implementation
are deliberately separate phases.

---

## Ledger

| ID | Title | Area | Severity | Effort | Phase | Status |
|----|-------|------|----------|--------|-------|--------|
| [F001](F001-conversational-template-advisor.md) | Conversational template advisor with visual multi-select → project start | Home chat · design library · GenUI | High — core demo path | L (phased P0/P1/P2) | P0 ready | 🔬 Scoped |
| [F002](F002-client-discovery-interview.md) | Native client discovery interview — 3 tiers, sendable, embeddable, project-starting | Intake · question-forms · sharing · scaffold | High — validated on live users | L (phased P0/P1/P2) | P0 ready | 🔬 Scoped |
| [F003](F003-team-collaboration-and-ledger.md) | Team collaboration — shared projects, named identity, change ledger, live chat, cursors | Architecture · identity · realtime | High value · high risk | XL (phased) | ⛔ Blocked on Q1 | 🔬 Scoped |
| [F004](F004-canvas-preview-double-parse-flicker.md) | 🐞 Canvas preview flickers to raw structure on every update | `FileViewer.tsx` preview inlining | High — visible every edit | S | **Fix ready** | ✅ Reproduced + measured |
| [F005](F005-message-center-upstream-leak.md) | 🐞 Message center serves upstream Open Design announcements, not team messages | `vela.ts` · `message-center-client.ts` | High — vendor marketing under MishMash branding | S (cut) · M (rebuild) | **P0 ready** | 🔬 Root cause confirmed |
| [F006](F006-design-jury-built-but-switched-off.md) | Design jury is built, tested (241 pass) — and has never run | `critique/` · `prompts/panel.ts` | High opportunity | XS (enable) · M (validate) | **P0 ready** | ✅ Audited |
| [F007](F007-filter-standardization-and-section-facets.md) | Standardize all filter controls; make sections (hero, footer…) filterable | `primitives.css` · 14 filter surfaces · design index | Medium-High | M + S | P0 ready | 🔬 Scoped |
| [F008](F008-render-fonts-in-their-own-typeface.md) | Show every font in its own typeface | `TypefacesSection.tsx` · `routes/typefaces.ts` | Medium — high value, low cost | S | P0 ready | 🔬 Scoped |
| [F009](F009-zero-blocked-library-assets.md) | Zero blocked library assets — wire all 277 in, usable and iterable | `RIGHTS.md` · `design-library.ts` | High — gates daily work | S + M | Needs source list | 🔬 Scoped |
| [F010](F010-ingest-desktop-ui8-kits.md) | Ingest 19 unwired UI8 kits (3.2 GB) from the Desktop | `mishmash-assets/` · library ingest | Medium — paid assets unused | M | Depends on F009 | 🔬 Scoped |
| [F011](F011-template-entry-file-picks-iframe-shim.md) | 🐞 Projects from user-installed templates open a blank canvas — entry file resolves to an iframe shim | `design-library.ts` `detectEntryFile` · `project/index.ts` `detectTemplateEntryFile` | High — 199/199 user-installed templates; 0/352 shipped | S | **P0 ready** | 🔬 Root cause confirmed |

**Status values:** 📝 Captured → 🔬 Scoped (PRD complete) → 🌙 Queued (in overnight run) → 🔨 In progress → ✅ Landed → ⏸️ Deferred

---

## How to add a note

Say it in any form — a sentence, a complaint, a half-idea. Each note gets:

1. **Verbatim capture.** The raw note is preserved word-for-word so intent is never
   lost to paraphrase.
2. **Grounding.** The current behaviour is verified against real code, with file
   paths and line references. No PRD asserts a gap that wasn't checked.
3. **A PRD** with numbered, testable requirements; phased P0/P1/P2 so an overnight
   run lands something coherent even if it doesn't finish everything.
4. **Measurable success criteria** plus the exact verify commands to run.

---

**Suggested overnight order:** **F005 P0, F004, and F011 P0 first** — smallest, root cause already traced, and they
clean up the surface every other demo runs on. F011 in particular gates the templates path: every project
started from a user-installed template currently opens empty. Then F001 P0, then F002 P0. **F003 is blocked**
on a product decision (shared daemon vs. multi-tenant) and must not be started unattended.

**F007 rides F001's index.** The `sections[]` facet belongs in F001 R1's `index.json` — build
F001 R1 first, then F007 R7 extends it. Two indexes would be a review failure.

**Cross-finding dependency:** F002's `ClientBrief` output is F001's advisor input, and both
share the archetype vocabulary in `apps/daemon/src/design/site-archetypes.ts` (F001 R3).
**Build F001 R1–R3 before F002 R5/R6** — otherwise the archetype layer gets written twice.

---

## Conventions

- One file per finding: `F<NNN>-<slug>.md`. Never renumber — IDs are permanent.
- Findings are append-only during the demo. Revisions go in a `## Revisions` section
  at the bottom of the finding, not by rewriting history.
- **No secrets in this directory.** `wiggdevin/mishmash` is a public repo. Credentials
  are referenced by ZS Vault ID and env var name only.
- Repo rules still bind: `AGENTS.md` is the single source of truth, including the
  **Design authority** section, whose enforceable claims live in
  `docs/design-authority.json`.

---

## Overnight autonomous run

**Preflight**

```bash
cd ~/projects/mishmash
git status --short          # expect clean
pnpm install
pnpm guard && pnpm typecheck # baseline must be green BEFORE any work starts
```

**Per finding**

1. Branch: `feat/f<NNN>-<slug>` off `main`. One finding = one branch = one PR.
2. Work the PRD's P0 block to its acceptance criteria. Do not start P1 until every
   P0 criterion passes.
3. Verify with the finding's own **Verification** commands, plus the repo gates:
   `pnpm guard`, `pnpm typecheck`, `pnpm i18n:check`.
4. Open a PR with the summary and test plan.

**Merge policy for this batch — recommended default: PR open, held for review.**
These are product/UX features on a public repo, decided in a live demo. The global
`zs-land` default would squash-merge them unattended; my recommendation is to hold
so you review the UX in the morning. Flip this line to `auto-land` if you'd rather
wake up to merged work — your call, and I'll follow whichever is set here.

> **Current setting: `hold-for-review`**

**Guardrails**

- Never touch `design-templates/` or `mishmash-assets/` content to make a test pass.
  Fix the ranking or index instead — the library is data, not a knob.
- MotionSites prompt text must never enter this repo (rights rule, 2026-08-10).
- If a P0 criterion can't be met, stop that finding, leave the branch and PR open with
  a written blocker, and move to the next finding. Do not weaken the criterion.
