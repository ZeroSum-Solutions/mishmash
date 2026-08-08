# MishMash Interface Program — founder list execution plan

**Created:** 2026-08-07 · **Revised:** 2026-08-08 v9 FINAL (founder closed the review arc at round 8 — see §10d; round-8 residuals dispositioned in-text or carried as named freeze-time obligations)
**Status: ACTIVE — approved by founder ruling §10d. Wave PRDs may now be written; every wave still freezes only through its own adversarial review, where the carried obligations below are binding review criteria.**
**Owner:** Devin (founder) · **Driver:** Claude Code session (Fable 5)
**Sources of truth:** founder list (this session, grilled over 3 rounds), ground-truth scout report (2026-08-07, HEAD `a29700fc3`) *as corrected by Sol rounds 1–6*, `docs/plans/waves/README.md` + `GLOBAL-GOAL.md` + `VERIFICATION-CONTRACT.md` + `leases.json`, `docs/plans/2026-08-05-model-routing-system.md`, `docs/plans/2026-08-03-client-website-studio-prd.md` §21, Router Capsule rev 2 (`~/Inbox/notes/website-design-build-ai-router-second-brain-capsule-revision2-2026-08-04.md`).

---

## 1. Founder list → disposition (grill outcome)

| Item | Disposition |
|---|---|
| Product direction: web-first + Apple desktop companion | **Companion DEFERRED entirely** (founder, this session). Record in `DECISIONS.md`; intended future shape = native Swift companion over the daemon HTTP API (not Electron — its removal stands). No build work. |
| 1. Website build QA + AI SEO ("Scan & Compile") | **New standalone wave WS.** Live checklist scanning for local-SEO signals, missing pages/metadata/CTA/schema/trust, creative-direction A/B prompts. Standalone because W6a-P is **permanently parked** (see §1a). |
| 2. AI business-image enhancement | **New wave WI.** Enhance/clean photos; before→after and after→before generation; AI-generated labeling in artifact metadata. Providers = user-connected accounts (Gemini image, OpenRouter where servable) behind one pluggable interface. Never operator credentials. |
| 3. Agency→client handoff | **New wave WH.** Export/import signed workspace bundle: project, design system, connector *configs* (never secrets), defaults, permissions, model choices. Client re-authorizes connectors on import. Local-first preserved; no hosted multi-tenant. |
| 4. Onboarding + billing | **New wave WO.** OpenRouter connector onboarding: connect, verify access, top-up via deep-link to OpenRouter's hosted purchase page only after explicit confirmation, skippable with defaults. No in-product payment handling. |
| 5. Model routing (five-model) | **Mostly landed** — WR P0–P2 complete; post-landing proof manifest bound to `a29700fc3`, 18/18 pass (`~/.claude/goal-state/wr-routing/proof/manifest.json`). Remainder = **wave WR2**: integrate Router Capsule rev 2's five-model decision (Opus 5 creative / Kimi K3 signature frontend / GPT-5.6 Sol engineering+verification / Luna-Terra-or-DeepSeek-V4-Flash routine / Gemini 3.6 Flash visual QA) into the landed routing policy, plus residual research: FluidVoice.app onboarding inspection (installed locally), identify the GitHub partial-local-components project ([PUBLISHED]-verified), assess Chinese open-weights for limited local tasks, Luna pricing freshness check. Model-routing plan P2.5/P3/P4/P5/P6 stay gated — not in this program. |
| 6. Memory | **DROPPED by founder** (this session). No action; NM-21 ruling untouched. |
| 7. UX + editing | **New wave WU.** Mobile-friendly card view, full-screen editing mode, simpler/more-obvious text editing, in-page image editor. Avoid mouse-heavy interactions; guided flows, fast defaults. **Supersedes** `docs/plans/manual-edit-mode-implementation.md` — see §1b. |

### 1a. W6a correction (Sol round-1 F2; rounds 2–6 confirmed)

The §21 Fable confirmation pass was already **spent** (invocation marker + terminal **REVISE** result under `~/.claude/goal-state/mishmash-w6a-plan-freeze/reviews/`). Per PRD §21 it is a permanent one-shot: **W6a-P is permanently parked.** WS proceeds standalone by design. Reviving W6a requires a *new* founder decision record superseding §21 — open item **D1**, default = stays parked.

### 1b. Manual-edit plan absorption (Sol round-1 F14)

`docs/plans/manual-edit-mode-implementation.md` is stale (based on commit `72edd4fc…`; the production manual-edit bridge already exists in `FileViewer.tsx`). WU's PRD marks it **SUPERSEDED** at freeze and explicitly invalidates: (i) its prototype-migration framing (bridge already landed), (ii) its fallback-locale instruction (violates English-only), (iii) its root `pnpm test` commands (violates the package-scoped test boundary). Anything else it describes is re-derived from the current tree in the WU PRD, not inherited.

## 2. Repo reconciliation (scope rule c) and priority

- **W8 Selector: IN, D2 AUTHORIZED (founder ruling (a″), §10c), self-contained closure.** (i) Governance sequence per Sol rounds 2–4: **D2 (§8, authorized) → full sealed-scoring amendment lands under an amended W7 lease as its own adversarially-reviewed change (corpus-loader + paired `scoreSealedComposition`/injectable `scoreComposition` + `verify-w8.ts` C8-8 rewrite), re-pinned → W8 PRD freeze re-review → lease per its own PRD → implementation.** (ii) Concurrency (Sol round-6 r6-H1): because W8's lease names shared composition files (`server.ts`, `cli.ts`, `providers/registry.ts`, `capability-manifest.json`), **W8 implementation may not run concurrently with WU/WS/WO or with an active WX tranche — it starts only after WU/WS/WO have landed, and its landing is serialized against WX tranches by the merge-only writer.** (iii) **W8 is exempt from §4 Rule 4's inert pattern** (Sol round-7 nH3: its verifier demands a live route/CLI/manifest row, so it cannot land inert): W8 lands its own full capability closure — route, contracts, CLI, UI entry — in its own landing under its own re-frozen lease. That lease must therefore add `apps/web/src/components/NewProjectPanel.tsx` and the two i18n files as enumerated temporal overlaps (editable only after WO and WX-o have landed; the freeze re-review verifies the enumeration), and its shared-composition needs are the one enumerated exception to WX's Rule 2 exclusivity (§4). There is no WX-8 tranche. **Carried obligation (Sol round-8 NEW-2, binding at W8's freeze re-review):** the `verify-w8.ts` rewrite must strengthen C8-5, C8-11, and C8-13 to genuinely enforce full closure — real route assertions including upload/URL controls, a real run rather than a fabricated status-only check, and CLI checks covering `--json`, payload comparison against the UI path, and guard execution — the current checks false-green (verify-w8.ts:1170–1235).
- **D3 gate:** the founder's R3-Q2 inclusion ruling (W8 runs in this program rather than after `GLOBAL-GOAL.md`'s W5→W6a→W6b order) **must be written to `DECISIONS.md` before A4 begins**. Drafted; commits with founder approval of this plan.
- **W10b VoiceBox: IN, full contract, ceremony-first.** Run its pending round-6 confirmation review; on APPROVE → lease grant → implement (scope stays founder-pinned: register the MCP and stop). **Its confirmation review must additionally verify its lease names no §4 shared composition file; any such mount routes through WX instead** (Sol round-6 r6-M5 — no open-ended "per its PRD" grant).
- **GitHub issues (seven): #37, #46–#51: IN, light tier.** Ordinary bug-fix PRs, not waves. Verified with a timestamped receipt: `~/.claude/goal-state/interface-program/receipts/gh-issues-2026-08-07.json` (captured 2026-08-08T03:02Z at HEAD `a29700fc3`, all seven OPEN).
- **Queued, next run:** W9 filesystem/agent-spawn/external-fetch tranches, W10a/c/f (all pre-implementation, several with active review arcs on rounds 4–6), W5 expansion, model-routing P2.5–P5.
- **Deferred:** destructive housekeeping — after the program settles.

**Priority (founder-confirmed):** WU → WS → WO → WI → WR2 (research runs cheap in parallel) → WH. W8/W10b/issue lanes run alongside without consuming list-lane priority.

## 3. Governance — tiered (founder, R1-Q4)

- **Full contract** (wave identity + lease in `leases.json` before first write, `scripts/waves/verify-<wave>.ts` verifier, commit-bound proof manifest under `~/.claude/goal-state/<slug>/proof/`, adversarial review reviewer ≠ author, red-green loop per `VERIFICATION-CONTRACT.md` §6): **WU, WS, WO, WI, WH, W8, W10b, and WX** — every wave, no exceptions.
- **Light tier** (red spec → fix → green + one Sol review) applies **only to non-wave work**: the seven GitHub issues and the PP-0 precursor (§4 Rule 4a).
- **WR2**: research half produces a Sol-verified brief (docs-only); the capsule-integration half becomes a full-contract wave when it touches product code.
- **Merge-only integrating writer** (per `VERIFICATION-CONTRACT.md`): exactly one integrating writer performs **all merges** from fresh `origin/main`; wave agents (including WX's) never merge their own work. The writer authors no product code.
- Every wave PRD is written, adversarially reviewed, and **frozen before its implementation agent starts.**
- Stop rule per contract: three consecutive non-APPROVE verdicts, or non-decreasing HIGH count across three rounds → stop, escalate to founder. *(Tripped twice at plan level; both resolved by founder rulings — §10/§10b.)*

## 4. Shared surfaces — the WX integration wave (founder ruling (b′), replacing the deleted amendment machinery)

**Design principle:** parallelism lives in the implementation waves; shared-file integration was always serial. So the shared files belong to **one ordinary wave** — no novel governance invented, only shapes this program has already used (a wave = lease + verifier + criteria; tranches per the WR precedent; cross-wave edits inside a named lease per W1/C2-1a).

**Rule 1 — implementation waves are mechanically disjoint.** Each implementation wave's lease contains ONLY (a) its new modules and (b) its single-owner chain:
- **WU owns**: `apps/web/src/components/ProjectView.tsx`, `FileWorkspace.tsx`, `FileViewer.tsx`, `apps/web/src/styles/viewer/**`, `apps/web/src/styles/workspace/**` **except `artifacts.css`**.
- **WO owns**: `apps/web/src/App.tsx` (Sol round-7 nM6 path correction — the file lives at the app root, not under `components/`), `apps/web/src/components/EntryShell.tsx`, `EntryView.tsx`, `NewProjectPanel.tsx`, `NewProjectModal.tsx`, `apps/web/src/styles/home/**`.
- New styling defaults to new CSS Modules next to new components (repo policy); no implementation wave touches any §4 shared file, ever.

**Rule 2 — WX owns the shared composition files, exclusively:** `apps/daemon/src/server.ts`, `apps/daemon/src/cli.ts`, `apps/daemon/src/server-context.ts`, `apps/daemon/src/route-context-contract.ts`, `scripts/waves/capability-manifest.json`, `packages/contracts/src/index.ts` (barrel), `apps/web/src/i18n/types.ts`, `apps/web/src/i18n/locales/en.ts`, `apps/web/src/index.css`, `apps/web/app/layout.tsx`, `apps/web/src/providers/registry.ts`, `apps/web/src/styles/workspace/artifacts.css`. **In addition (Sol round-7 nH2), WX's lease enumerates temporal-overlap files:** `apps/web/src/components/FileWorkspace.tsx` (overlap with WU) and `apps/web/src/components/NewProjectPanel.tsx` (overlap with WO). These are not exclusive — the implementation wave owns each file until it lands; **WX may touch an overlap file only in a tranche whose gate requires that owner wave to have already landed** (so there is never a concurrent writer: the owner's agent is finished before WX's first edit). **"Exclusively" is likewise bounded by one enumerated exception (Sol round-8 NEW-1): W8's self-contained landing (§2) edits `server.ts`, `cli.ts`, `providers/registry.ts`, `capability-manifest.json`, and the two i18n files under its own re-frozen lease, as enumerated temporal overlaps with WX — legal only while no WX tranche is active, which the merge-only writer's serialization already guarantees. Both overlap sets appear in `leases.json` and are checked by `verify-wx.ts`.** The overlap enumeration lives in WX's `leases.json` entry and is checked by `verify-wx.ts` (precedent: WR Amendment 1's enumerated overlaps). WX is a full-contract wave: its own PRD (adversarially reviewed and frozen tonight with the others), its own lease in `leases.json`, its own `scripts/waves/verify-wx.ts`, its own proof manifest. **One agent.** `leases.json` itself is edited only by the merge-only writer when registering reviewed, frozen PRD leases — never mid-wave.

**Rule 3 — WX is tranche-structured** (precedent: WR P0/P1/P2). One tranche per producing wave: `WX-u` (WU mounts), `WX-s` (WS mounts), `WX-o` (WO mounts), `WX-i` (WI), `WX-h` (WH). Tranche-entry gate: **a tranche may start only after its producing wave(s) have landed** — WX-s gates on WS **and** WU (its panel mounts into `FileWorkspace.tsx`, which WX edits under its enumerated overlap only after WU landed); WX-i and WX-h likewise gate on any overlap file's owner having landed. There is **no WX-8**: W8 carries its own closure (§2, Sol round-7 nH3). Tranches execute **serially** (one WX agent), interleaved between wave landings as slots free.

**Rule 4 — atomic capability closure lives in WX, under founder policy amendment D4.** Repo policy (`AGENTS.md` Capability exposure) requires endpoint + contracts + UI + CLI to land in the same PR and forbids staging across PRs. A literal reading conflicts with any integration wave (Sol round-7 nH1), so this pattern runs under **D4 — a founder-ratified, program-scoped policy amendment recorded in `DECISIONS.md`** (ruling (a″), §10c): a capability may land as (1) an implementation-wave PR containing **only inert modules** — compiling, fully tested, unreachable: no route registered, no subcommand, no UI mount — followed by (2) **exactly one WX tranche PR that atomically activates it**: exports the DTOs through the contracts barrel, registers the route, adds the `SUBCOMMAND_MAP` entry, mounts the UI, adds the i18n keys, updates the capability manifest. All three user-facing surfaces appear in the same PR; no partial surface ever exists on `main`, which preserves the rule's intent (the rule guards against single-surface capabilities, and under D4 the count of live surfaces only ever steps 0 → 3). D4 covers WU/WS/WO/WI/WH + WX only; W8 is exempt (self-contained closure, §2); the seven issue fixes touch existing capabilities and don't invoke it. The exact file-level choreography per tranche is enumerated as criteria in WX's PRD (one criterion per mount, each with a test-ref), reviewed adversarially at its freeze.

**Rule 4a — PP-0 precursor makes inert modules compilable** (Sol round-7 nH5). `packages/contracts/package.json` currently exposes no wildcard subpath export, so a wave-local DTO module under `packages/contracts/src/api/<name>.ts` (a new file, inside the wave's disjoint lease) would be unimportable before WX exports it through the barrel — and duplicating DTOs wave-locally would violate the shared-contracts boundary. **PP-0** is a single additive change, landed and adversarially reviewed before any implementation wave starts: add a subpath export pattern (e.g. `"./api/*"`) to `packages/contracts/package.json` exports **and extend `packages/contracts/esbuild.config.mjs` so `src/api/*.ts` modules emit runtime output — the build lists entry points explicitly today, so an exports-map-only change would resolve types but leave runtime imports dangling (Sol round-8 grading of nH5)**. Inert daemon/web modules then import their own DTO module via the subpath (`@open-design/contracts/api/<name>`), typechecking against the real shared contract from day one; the WX tranche adds the barrel export at activation as the canonical public path. **Governance tier (Sol round-8 NEW-3): PP-0 is not a wave — it runs light tier** (red spec: a subpath import that fails to resolve at build/runtime today → fix → green, plus one Sol review before merge), verified by `pnpm --filter @open-design/contracts build` + the subpath-import smoke test executed against `dist/`.

**Rule 5 — conflicts stop, they don't negotiate.** An implementation wave that discovers it needs a shared-file edit mid-flight stops; the need becomes a WX criterion **through the one legal amendment path** (Sol round-7 nH4): a WX PRD amendment plus, if a file outside WX's registered lease is required, a WX lease amendment — both adversarially reviewed, founder-approved, and registered by the merge-only writer **only between tranches, never mid-tranche** (the amended lease takes effect from the next tranche's `baseCommit`, so the base-anchored verifier sees it). An intersection between two implementation waves' leases discovered mid-flight stops both and routes to this section by plan revision. Never by agents agreeing.

**What this deletes** (from v4–v6, per founder ruling): landing-slot lease amendments, grant tables and revocation lifecycle, anchor windows, BYTE-PRESERVE adoption, "formal release," owner-lands-first grants. Sol round-6 findings r6-H1/H2/H3/M4/M5 are dispositioned by deletion of their target mechanism plus the W8 concurrency bar (§2) and the W10b lease check (§2).

## 5. Model lanes (founder-confirmed, subscription-first)

| Role | Lane |
|---|---|
| Wave drivers (WU/WS/WO/WI/WH implementation) | Claude **Opus 5** via Max OAuth |
| WX integration agent | **Opus 5** via Max OAuth (precision wiring, small diffs) |
| Long-horizon `/goal` runs (W8 post-D2, post-WU/WS/WO) | **Fable 5** via Claude OAuth |
| Mechanical subagents, issue lane, scouts | **Sonnet 5** |
| Adversarial reviewer (all waves; reviewer ≠ author — authors are Claude) | **GPT-5.6 Sol** (Codex subscription), xhigh for verdicts |
| Visual/design QA on UI waves | **Gemini via `agy`** |
| Research fan-out | Sonnet 5 + `agy`; Grok via Nous optional second prose adversary |
| Metered (DeepSeek direct, OpenRouter) | Overflow only, after subscription/prepaid |

Program constraint carried from PRD §15 governance: no Anthropic model on API credits, Nous, or OpenRouter — Claude lanes are OAuth-only.

## 6. Execution

**Concurrency ceiling: at most 5 concurrent product-code-writing agents, total** — worktree implementation agents, the single serial issue-lane agent, and the WX agent when a tranche is active. The merge-only writer authors no product code and is uncounted; reviews and research are uncounted.

**Burst A — tonight:**

| Lane | Work | Kind | Tier | Driver |
|---|---|---|---|---|
| A1 | WU ux-editing: PRD → freeze review → implement (inert until WX-u) | Implementation | Full | Opus 5 |
| A2 | WS scan-compile: PRD → freeze review → implement (inert until WX-s) | Implementation | Full | Opus 5 |
| A3 | WO onboarding: PRD → freeze review → implement (inert until WX-o) | Implementation | Full | Opus 5 |
| A4 | W8 ceremony chain (D2 authorized): D3 record → W7 sealed-scoring amendment as its own reviewed change → freeze re-review; **implementation only after WU/WS/WO land** (§2) | Ceremony chain, then implementation | Full | Opus 5 amendment; Sol reviews; Fable 5 implement |
| A5 | Issues #37, #46–#51 (seven) — one agent, serial | Implementation | Light | Sonnet 5 |
| A6 | W10b: round-6 confirmation review (incl. shared-file lease check) → on APPROVE: lease + registration | Ceremony, then implementation | Full | Sol review; Sonnet 5 implement |
| A7 | WR2 research + capsule-integration PRD draft | Research (docs-only) | Research | Sonnet/agy → Sol verify |
| A8 | **PP-0** (contracts subpath export + esbuild emission, light tier, lands first) + **WX PRD** (mount criteria inventory for WX-u/s/o/i/h) → freeze review; tranches execute as producing waves land | Precursor (light) + integration wave (full) | Light + Full | Opus 5 |

Peak product-code writers: A1+A2+A3+A5 = 4 during implementation; the 5th slot rotates among W10b (post-ceremony), the W7 amendment change, and WX tranches (post-landings). W8 implementation joins only after WU/WS/WO land and never alongside an active WX tranche.

**Burst B — as lanes free:** WI images (full; WX-i follows), then WH handoff (PRD + adversarial review tonight; implementation after review — largest architecture, last by founder priority; WX-h follows).

**Wave surface sketches** (final allow-globs computed by real glob-intersection at each PRD freeze, §4 rules applied):

- **WU:** owned chain + style homes (§4 Rule 1) + new components/CSS Modules. **Capability test per `AGENTS.md`: a user-facing capability requires the full closure regardless of client- or server-side implementation.** The WU PRD classifies every feature explicitly: image-edit operations = capability (closure activates in WX-u); card view / full-screen mode = presentation of existing capabilities (rationale recorded, reviewed at freeze).
- **WS:** new `apps/daemon/src/scan/**` + new route module + new contracts module + new web panel component + `od scan` code — all inert until WX-s activates them atomically.
- **WO:** new connector modules + owned entry chain + `od connector` code — inert until WX-o.
- **W8:** per its own re-frozen PRD (D2 authorized), post-WU/WS/WO; self-contained closure incl. `NewProjectPanel.tsx` + i18n as enumerated temporal overlaps (§2).
- **WX:** §4 Rule 2 lease; criteria = the mount inventory, one per capability activation, each with test-ref.

## 7. Review record

| Round | Reviewer | Verdict | Disposition |
|---|---|---|---|
| 1 | GPT-5.6 Sol (Codex, xhigh, repo access, read-only) | **REJECT** — 17 findings (7 HIGH) | Dispositioned in v2. |
| 2 | GPT-5.6 Sol (same posture) | **REJECT** — 7 new findings (4 HIGH) | Dispositioned in v3. |
| 3 | GPT-5.6 Sol (same posture) | **REJECT** — 4 residual (3 HIGH) | Dispositioned in v4; stop rule tripped; founder option (a) — §10. |
| 4 | GPT-5.6 Sol (same posture) | **REVISE** — 5 findings (3 HIGH) | Dispositioned in v5. |
| 5 | GPT-5.6 Sol (same posture) | **REVISE** — 6 findings (2 HIGH) | Dispositioned in v6. |
| 6 | GPT-5.6 Sol (same posture) | **REVISE** — 5 findings (3 HIGH), all targeting the amendment mechanism | Stop rule re-tripped; founder ruling (b′): mechanism deleted, WX wave adopted — v7 §4. r6-H1 → §2 W8 concurrency bar; r6-H2/H3/M4 → moot (mechanism deleted); r6-M5 → §2 W10b lease check. |
| 7 | GPT-5.6 Sol (same posture) | **REVISE** — 5 HIGH / 2 MED / 1 LOW; r6-H1 graded PARTIAL, r6-M4/M5 RESOLVED | Third stop-rule trip (§10b's immediate-re-escalation clause); founder ruling (a″) — §10c. Dispositioned in v8: nH1 → Rule 4 under D4; nH2 → Rule 2 overlap enumeration; nH3 → W8 exempt from inert pattern, WX-8 deleted (§2); nH4 → Rule 5 between-tranche amendment path; nH5 → Rule 4a PP-0; nM6 → `App.tsx` path corrected; nM7 → review-artifact traceability (below). |
| 8 | GPT-5.6 Sol (same posture; target pinned sha256 `a644b975…`) | **REVISE** — nH2/nH4/nM6 RESOLVED, nH3/nH5/nM7 PARTIAL, nH1/nL8 UNRESOLVED; new NEW-1/NEW-2 (HIGH), NEW-3 (MED) | **FINAL round — arc closed by founder ruling (§10d).** v9 dispositions: nH1 → AGENTS.md gains the D4 exception pointer in this landing; NEW-1 → W8 shared-file needs enumerated as Rule 2 temporal overlaps; NEW-2 → carried obligation at W8 freeze re-review (§2); nH5 residue + NEW-3 → Rule 4a: PP-0 gains esbuild emission scope, assigned light tier; nM7 → INDEX mapping completed best-effort, historical sha gap acknowledged as permanent; nL8 → discharged at WX PRD freeze. |

**Review-artifact traceability (Sol round-7 nM7):** each round's full verdict text is stored at `~/.claude/goal-state/interface-program/reviews/round-<n>.md` as it arrives (rounds 1–7 backfilled from session task outputs where retained). This plan file is committed to the repository via PR immediately upon APPROVE so subsequent wave-freeze reviews cite an immutable target; until then each review round's target is pinned by the sha256 of the plan file recorded in the round's artifact.

## 8. Founder items

- **D1 — W6a revival?** Default: stays permanently parked per §21's spent one-shot. Say the word only for a *new* superseding decision record.
- **D2 — AUTHORIZED** (founder ruling (a″), 2026-08-08 "go with your recommendation", §10c): the full C8-8 sealed-scoring amendment (corpus-loader + paired `scoreSealedComposition`/injectable `scoreComposition` entrypoint + `verify-w8.ts` C8-8 rewrite, landed as one adversarially-reviewed change, re-pinned before the W8 freeze). Records to `DECISIONS.md` with plan approval.
- **D3 — W8 ordering supersession**: drafted for `DECISIONS.md`; commits with founder approval of this plan; A4 additionally gated on the record existing.
- **D4 — capability-closure policy amendment, RATIFIED** (founder ruling (a″), §10c): program-scoped amendment to `AGENTS.md`'s same-PR closure rule per §4 Rule 4 — inert implementation PR + exactly one atomic WX activation PR carrying all three surfaces; no partial surface ever live on `main`. Records to `DECISIONS.md` with plan approval; cited in every affected wave PRD and in each WX tranche PR body.

## 9. Realism

Tonight's realistic landings: several of the seven issues, W10b (if its review APPROVEs), the WR2 research brief, WH PRD frozen, WX PRD frozen, and WU/WS/WO PRDs frozen with implementation substantially underway. Capabilities become user-visible at their WX tranches, which follow their producing waves' landings — realistically tomorrow for the first ones. The full six-item founder list verified-and-landed remains a 2–3 day program. Every wave is resumable mid-flight via its goal-state.

## 10. First stop-rule escalation (2026-08-08 — RESOLVED)

Three consecutive plan-review REJECTs. Founder ruled **(a)**: v4 + round 4 authorized.

## 10b. Second stop-rule escalation (2026-08-08 — RESOLVED)

Three consecutive REVISE verdicts (rounds 4–6), all concentrated on the landing-slot amendment mechanism. Founder ruled **(b′)** ("b", 2026-08-08, this session): **delete the amendment machinery entirely; adopt the WX integration wave** (§4). This record authorizes review round 7. A round-7 non-APPROVE re-escalates immediately.

## 10c. Third escalation (2026-08-08 — RESOLVED)

Round 7 returned REVISE (5 HIGH), triggering §10b's immediate re-escalation clause. All findings were WX execution detail with concrete fixes; one (nH1) required a founder policy ruling. Founder ruled **(a″)** ("a — go with your recommendation", 2026-08-08, this session): **D4 ratified** (closure-policy amendment, §8), **v8 authorized** with the seven fixes (§7 round-7 row), **round 8 authorized**, and — per the founder's standing "go with your recommendations" instruction — **D2 authorized** as recommended (noted back to founder with explicit veto opportunity). A round-8 non-APPROVE re-escalates immediately.

## 10d. Arc closure (2026-08-08 — FINAL)

Before round 8 returned, the founder ruled: **"this will be our final round. then please commit and push."** Round 8 returned REVISE (residuals nH1/nH3 partial-or-unresolved; new NEW-1/NEW-2 HIGH, NEW-3 MED). Per the ruling, the plan-level review arc is **closed at 8 rounds** — no round 9. The REVISE verdict is recorded faithfully (§7; verbatim artifact `~/.claude/goal-state/interface-program/reviews/round-8.md`); the plan is adopted as v9 FINAL by founder authority, with each residual either fixed in v9's text (nH1 via the AGENTS.md D4 pointer, NEW-1 via Rule 2's W8 overlap enumeration, NEW-3 + nH5 via Rule 4a) or carried as a **binding freeze-time obligation** on the wave that owns it (NEW-2 → W8's freeze re-review; nL8 → WX's PRD freeze). Wave-level adversarial reviews continue unchanged — closing the plan arc does not close any wave's own red-green loop.
