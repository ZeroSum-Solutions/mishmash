# Founder decision records — mishmash-completion program

Program scaffolding (deleted with `scripts/waves/` at program close). Each entry is the binding
record for a decision listed as open in `GLOBAL-GOAL.md` §Founder decisions or raised during the
run. Severity/scope changes cite these records per `VERIFICATION-CONTRACT.md` §3 R6/R7.

## 2026-07-27 — Devin (founder), in-session

| ID | Ruling | Provenance |
|---|---|---|
| NM-03 / NM-01 | **KEEP** internal identifiers (`od`, `OD_*`, `.od/`, `SERVER_NAME`) and the `@open-design/*` scope. W11 (namespace & fork ops) will not fire. C0-12 stored-identity inventory still runs (inventory-only, per W0 PRD). | Founder direct; aligns with both auditors' HIGH recommendation |
| NM-24 | **Seam only**: MishMash↔Instatic integration stays at the MCP server + Super Import boundary. Deeper coupling rejected (fork-pin maintenance surface, no repo references today). W10a scope pinned accordingly. | Founder-delegated to GPT-5.6 Sol; verdict adopted per founder instruction ("use GPT to help make a decision and go with that") |
| NM-21 | **Library embeddings only** for memory scope. No managed-RAG evaluation. W5/W10e pinned. | Founder direct |
| NM-25 | **Register the VoiceBox MCP and stop.** No voiceover workflow scoping. W10b pinned to registration. | Founder direct ("only register the MCP") |
| NM-29 | **Formally closed, no code change.** The `t4-scroll` scroll-speed symptom has no reproduction anywhere in the tree, history, or docs; `fix/clone-preview-marquee-speed` contains zero unique commits (stale ancestor of main); three rounds of W-C hardening have since landed on the same code path. Reopen only on a concrete sighting, with a red spec in `apps/daemon/tests/web-clone-*.test.ts`. | Founder: "go ahead and complete it"; disposition from read-only investigation 2026-07-27 |
| NM-30 | **Ratified.** The clamp-aware mirror-width baseline override (`gate-decision.mjs` `expectedScrollWidth` vs raw baseline, 5% tolerance retained; documented in `skills/web-clone/SKILL.md` clamp-vs-baseline contract) is accepted as shipped. Revert path if ever rejected: restore strict raw-baseline comparison in `gate-decision.mjs`/`mirror-site.mjs`. | Founder: "go ahead and complete it" |
| NM-31 | **Closed as no-op.** The `od2-debloat` worktree does not exist on this machine (exhaustive search: repo worktrees, local + remote branches, reflog, home depth-2). Nothing to delete. If it exists on another machine, deletion is separately authorized there after an unlanded-work inspection. | Founder authorized deletion; target absent |
| NM-33 | **Membership stays print-mode.** ~$100 Moonshot Open Platform API credits purchased 2026-07-27; verified non-transferable to Kimi Code/Kimi+ subscriptions (separate wallets, non-refundable ToS updated 2026-05-27). Credits to be consumed via the approved Kimi K3 API lane. W1's silent-success guard proceeds unchanged. | Founder purchase + delegated carryover check |
| W-C mask ruling | **Keep the widened opaque-span mask** (landed in `f0c4bda56`). The stricter revert-unquoted-rewrite alternative is declined: CC-6 requires unquoted URL-attribute coverage, tests prove the mask's correctness, and its failure mode is one-sided (under-rewrite fails the verify-mirror gate loudly). Supersedes the "founder may swap" note in the W-C close-out summary. | Founder-delegated to GPT-5.6 Sol; verdict adopted |
| Standing directive | Autonomous continuation of the program authorized end-to-end ("continue on our goal, never stop for anything"). Blockers are surfaced in summaries, not waited on. `human:` criteria still resolve to `blocked-on-founder` per contract §3 R7 — this directive does not convert them to mechanical passes. | Founder direct |

## Sequencing waivers already in force

- **CC-11 / W-C landing order** (2026-07-26): W-C's "lands after W0" precondition waived by
  founder instruction before this program run started; recorded in
  `~/.claude/goal-state/mishmash-wc-clone-closeout/run.log.md`. W-C-only — every other wave
  still lands after W0 per `GLOBAL-GOAL.md` rule 1.
