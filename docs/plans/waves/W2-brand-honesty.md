# Wave 2 — Brand honesty & docs

**Slug:** `mishmash-w2-brand-honesty`
**Gates on:** W0 (backup only — this wave touches user-visible identity)
**Parallel with:** W1 (disjoint: this wave owns `apps/web/public/`, README, i18n, `clipper/`,
`docs/`; W1 owns daemon runtimes and picker logic)
**Loop:** `loop:red-green-review`

## Why this wave exists

The backlog's rebrand audit was largely stale — most of it already shipped. But the audits found
**live old-brand surfaces the note never listed**, including one that sends real network traffic.
This wave closes the genuine tail and, importantly, **retracts two false "DONE" claims** from the
assessment itself.

## Scope

**Retraction 1 — `open-design.ai` is live** (assessment D-11 was wrong).
`apps/web/src/components/EntryShell.tsx:228` defaults the onboarding newsletter to
`https://open-design.ai/subscribe`. Also active: provider header `X-Title: Open Design`, and
plugin-share UI text. Re-inventory **user-visible and network-egress** brand surfaces
specifically — the earlier sweep only checked `whats-new.ts` and wrongly generalized.

**Retraction 2 — A3 is not done** (assessment D-06 was overclaimed).
`clipper/i18n.js` still ships extensive non-English UI dictionaries. Single `en.ts` proved only
that the *web-app dictionary* was slimmed. Also outstanding: `en.ts:3521`
`settings.memoryEmptyHintZh` (orphaned, referenced by nothing), `design-toolbox.ts` `searchTerms`
Chinese entries, `title_i18n`/`description_i18n` metadata, humanize-ppt plugin content.
**Classify before deleting:** deliberate multilingual *content* is different from unwanted
foreign *UI chrome*. Only the latter goes.

**NM-02 — Stale PNG brand assets.** `apps/web/public/app-icon.png` and `logo.png` still carry the
old Open Design cursor glyph, and `apps/web/app/layout.tsx:11-13` wires `app-icon.png` as both
favicon and apple-touch-icon — the browser-tab icon is still the old brand. The SVGs were fixed
and pinned by `home-logo-assets.test.ts`; **extend that test to the PNGs** so this cannot recur.

**NM-05 — README.** 55.9 KB, fully upstream-branded: hero banner, "Open Design Cloud", Discord
links. The most-read file in the repo, untouched by every de-brand pass.

**NM-06 — Upstream metadata route.** `routes/open-design-public-metadata.ts` (74 lines) serves
`/api/github/open-design` GitHub stats and a Discord invite for the *upstream* project. Delete or
repoint; if any UI consumes it, remove the consumer too.

**NM-03 — Internal-identifier policy (founder decision, then document).**
`SERVER_NAME='open-design'`, `OPEN_DESIGN_GITHUB_REPO_URL`, `.od-brand-glyph`, `.od/`, `OD_*`,
the `od` binary, and `@open-design/*` packages. **Both auditors recommend keeping them** — the
repo is a hard-pinned fork (`docs/FORK-PIN.md`, pinned at `b9f550854`) where cherry-picks are the
only update lane, and renaming maximizes conflict surface for near-zero user value. Whatever the
founder rules, **write it down** as a deliberate decision so future agents stop re-litigating it.

**NM-26 — Docs honesty.** `docs/spec.md` and `docs/roadmap.md` are archived, but that caveat
lives only in `AGENTS.md` — a reader browsing `docs/` absorbs stale product claims. Mark archived
files **in-file**, at the top. Full documentation-set generation (0.3) is deferred until product
decisions stabilize; marking staleness is the urgent half.

## Explicitly out of scope

`NM-01` (the `@open-design/*` rename, 760 imports / 20 packages) — deferred to W11 or never, per
both auditors. Do **not** opportunistically start it here.

## Success criteria

All criteria inherit `VERIFICATION-CONTRACT.md` §3. Verified by `scripts/waves/verify-w2.ts`.

> **Lease note:** `EntryShell.tsx` belongs to W1 this burst. The newsletter fix ships as W1's
> `C1-13`; this wave's verifier reads the landed tree to confirm it. Do not edit the file here.

| ID | Criterion | Verification |
|---|---|---|
| C2-1 | No live old-brand egress — proven at **runtime**, not by grep | Capture **all** outbound requests during an exercised session (onboarding, provider call, share, metadata) and assert no `open-design.ai` host and no `X-Title: Open Design`. `X-Title` exists in multiple request paths; fixing the one named in the backlog and grepping for the rest is how the first sweep missed a live URL |
| C2-2 | Brand-surface inventory is **allowlist**-based | A typed inventory of user-visible/egress brand surfaces with a rationale per entry, wired into `pnpm guard`. A denylist of today's known-bad strings passes the moment someone adds a new one |
| C2-3 | The guard actually catches reintroduction | Mutation test: inject an old-brand string into each inventoried surface class; each injection must fail `pnpm guard`. Then revert |
| C2-4 | Favicon and apple-touch-icon are MishMash | PNGs replaced; `home-logo-assets.test.ts` extended to cover them (red before, green after) |
| C2-5 | README is MishMash's, asserted by **required content** | No upstream hero/Cloud/Discord references **and** required sections present (what this fork is, its relationship to upstream, the `FORK-PIN` lane, how to run it). Otherwise "replace README with three lines" passes |
| C2-6 | Upstream metadata route **removed or repointed** — no doc-only escape | Route deleted (consumers cleaned) or repointed. §3 R5: "documented as deliberate" is **not** available while it still serves upstream GitHub stats and a Discord invite. Egress is behavior, not documentation |
| C2-7 | Foreign UI chrome removed, deliberate content retained | `clipper/i18n.js` non-English UI dictionaries gone; orphaned `memoryEmptyHintZh` deleted; retained multilingual content listed explicitly with reasons |
| C2-8 | Toolbox discovery does not regress | Before/after recall fixture for English queries against `design-toolbox.ts`. Deleting Chinese `searchTerms` is a **behavior change hiding in a cleanup** — if recall drops, it needs a product decision, not a quiet edit |
| C2-9 | Daemon residual de-brand | Share-helpers, `pluginFolderActions`, and sidecar handshake strings covered by the C2-2 inventory. This slice had no wave in the first draft — it fell into an ID collision and vanished |
| C2-10 | `human:` Internal-identifier ruling recorded | `docs/decisions/internal-identifiers.md` states the founder's ruling and rationale. **Resolved 2026-07-27 (NM-03/NM-01): keep** — internal identifiers and `@open-design` package scope retained, matching both auditors' recommendation. No longer blocked-on-founder; decidable as keep |
| C2-11 | Archived docs marked in-file | `spec.md` and `roadmap.md` carry a top-of-file archived banner |
| C2-12 | Fork maintenance cadence documented | Lightweight `docs/decisions/fork-cadence.md`: cherry-pick playbook against `b9f550854`, and the compatibility-alias inventory. Small doc, but it was assigned only to deferred W11, which means never |
| C2-13 | Gates | `pnpm guard`, `pnpm typecheck` exit 0; web tests green, no `skip`/`only`/`todo` added |

## Adversarial review

GPT-5.6 Sol. Focus: is the brand-surface inventory actually exhaustive this time (the previous
sweep missed a live URL by checking one file and generalizing)? Does the guard catch a
reintroduction, or only the strings that happen to exist today? Was any *deliberate* multilingual
content deleted as collateral? Does the searchTerms change alter toolbox discovery behavior
(that's a behavior change hiding in a cleanup)?
