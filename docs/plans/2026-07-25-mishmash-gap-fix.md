# MishMash Gap-Fix — PRD

**Repo:** `~/projects/mishmash` (formerly `Open Design 2`; remote `wiggdevin/mishmash`)
**Date:** 2026-07-25
**Source:** `~/Inbox/notes/2026-07-25-mishmesh-design-capability-audit.md`
**Slug:** `mishmash-gap-fix`

---

## Problem

MishMash has strong motion *knowledge* (8 GSAP skills, Three.js/shader skills, 16 working WebGL demos) but four defects block it from producing award-tier animated sites reliably:

1. The UI recommends 17 skills that do not exist — the router lies to itself.
2. The richest owned animation source (`react-bits` + its MCP server) is unreferenced anywhere in the repo.
3. Nothing measures whether generated motion is actually smooth. Screenshot diffing exists; runtime performance verification does not.
4. The global `CLAUDE.md` design doctrine leaks into every spawned agent, imposing a house token-contract and stack defaults that corrupt pixel-perfect cloning.

Plus two defects found during setup:
5. `pickChip()` reports "Bundled scenario is not installed. Reinstall the daemon" whenever the plugin list is empty for *any* reason — including daemon-down. It is missing the `pluginsLoading` guard its sibling code paths already have.
6. The English-only pass missed the plugin manifests: 441 of 455 still carry `zh-CN`/`zh-TW` strings.

## Non-goals (explicitly out of scope)

- Renaming the internal `@open-design/*` package scope.
- Removing MishMash's own `DESIGN.md` format (151 design systems depend on it).
- Migrating or upgrading `zs-workbench` (dead-end fork).
- The drag-and-drop inspiration/taxonomy system (separate future project).
- Adding design systems or templates. Inventory volume is already past the point of positive marginal value.

## Standing constraints

- **Google's `@google/design.md` stays available.** It is explicitly wanted.
- **Devin's global Claude design doctrine must not reach this repo.** Specifically the global `CLAUDE.md` §Design contract / §Design skill chain and `~/.cursor/rules/design.mdc`. Cloning fidelity requires the target site's CSS to be the spec — not a house token contract or stack default.
- **One motion clock, one scroll owner, one shared canvas.** Never two physics engines. Never two scroll owners.
- **Commit after every criterion that passes verification.** No batching.
- **Conventional commits, no co-author trailers** (repo policy, `AGENTS.md` §Git commit policy).

---

## Success Criteria

Each criterion is a command with an exit code. Proof is captured to `~/.claude/goal-state/mishmash-gap-fix/proof/<id>.txt`.

| ID | Criterion | Verification |
|---|---|---|
| **C1** | Repo-local `CLAUDE.md` establishes this repo's design authority and disclaims the global design doctrine; a repo test enforces its presence and required markers. | `node --import tsx --test scripts/check-context-isolation.test.ts` → exit 0 |
| **C2** | Every `preferredSkillIds` entry in `apps/web/src/runtime/design-toolbox.ts` resolves to a real `skills/<id>/` directory. Zero phantoms. | `node --import tsx --test scripts/check-toolbox-skill-refs.test.ts` → exit 0 |
| **C3** | `pickChip()` distinguishes "plugins still loading / daemon unreachable" from "plugin not installed". Red-spec first: test fails on current `HEAD`, passes after fix. | `pnpm --filter @open-design/web test -- HomeView.pickChip` → exit 0, plus captured red run on baseline |
| **C4** | No `zh-CN` / `zh-TW` / other non-English i18n keys remain in `plugins/_official/**/open-design.json`. | `node --import tsx --test scripts/check-plugin-manifest-english-only.test.ts` → exit 0 |
| **C5** | `react-bits` MCP server is registered in MishMash's MCP config and its tool list is reachable from the daemon. | `od mcp list --json` contains `react-bits` → exit 0 |
| **C6** | A `lenis` skill exists, passes the repo's skill-manifest validation, and appears in the daemon's skill registry. | `od skill list --json \| grep lenis` + `pnpm guard` → exit 0 |
| **C7** | A motion-verification gate measures FPS/long-frames on a rendered artifact. It **passes** a known-good page and **fails** a deliberately janky page. Both assertions in one run. | `node --import tsx --test e2e/tests/motion-gate.test.ts` → exit 0 |
| **C8** | GSAP licensing question answered in writing with a citation, and a recorded decision on whether GSAP may remain core infrastructure. | `test -s docs/decisions/gsap-licensing.md` → exit 0 |
| **C9** | The sanctioned default motion stack is recorded as an architecture decision, and one worked example artifact using it passes the C7 gate. | `node --import tsx --test e2e/tests/motion-gate.test.ts -- --artifact=reference` → exit 0 |

**Definition of done:** `python3 ~/.claude/skills/goal/scripts/check-complete.py mishmash-gap-fix` exits 0.

---

## Task graph

### Phase 0 — Foundation
- **T1** Write repo-local `CLAUDE.md` isolating the global design doctrine → **C1**
- **T2** Write `scripts/check-context-isolation.test.ts` guard → **C1**

### Phase 1 — Stop the lying (highest impact ÷ effort)
- **T3** Triage all 17 phantom skill IDs: build / remap / delete. Decision table recorded in the run log.
- **T4** Author the skills chosen for "build" in T3 → **C2**
- **T5** Write `scripts/check-toolbox-skill-refs.test.ts` guard; wire into `pnpm guard` → **C2**
- **T6** Red-spec + fix for `pickChip()` missing `pluginsLoading` guard → **C3**
- **T7** Strip non-English i18n keys from 441 plugin manifests → **C4**
- **T8** Write `scripts/check-plugin-manifest-english-only.test.ts` guard → **C4**

### Phase 2 — Connect what we already own
- **T9** Register `react-bits` MCP server in MishMash's MCP config → **C5**
- **T10** Author `skills/lenis` (Lenis + `ScrollTrigger.update` + `gsap.ticker`, single scroll owner) → **C6**

### Phase 3 — The motion gate
- **T11** Build deterministic scroll-state capture (`__MISHMASH_READY__`, `setScrollProgress()`), capture at 0/25/50/75/100%
- **T12** Build the FPS / long-frame measurement harness reusing the HyperFrames headless-Chrome pipeline
- **T13** Author the deliberately-janky fixture page and the known-good fixture page
- **T14** Assemble `e2e/tests/motion-gate.test.ts` — must pass good, fail janky → **C7**

### Phase 4 — Motion architecture
- **T15** Resolve GSAP licensing; write `docs/decisions/gsap-licensing.md` → **C8**
- **T16** Record the sanctioned default motion stack as an ADR; build one reference artifact that passes the C7 gate → **C9**

---

## Model routing

| Task | Model | Why |
|---|---|---|
| T1, T3, T15, T16 | **Opus 5 (this session)** | Judgment calls: doctrine wording, phantom-skill triage, licensing reading, architecture |
| T2, T5, T8 | **Sonnet 5** | Well-scoped guard scripts against a stated contract |
| T4, T10 | **Sonnet 5** (parallel) | Templated SKILL.md authoring against existing gsap-* siblings |
| T6 | **Opus 5** | Red-spec discipline; must go red on baseline first |
| T7 | **Haiku 4.5** | 441 files, purely mechanical key deletion |
| T9 | **Sonnet 5** | Config wiring |
| T11–T14 | **Fable 5 @ xhigh** | Hardest piece; long-horizon, must be correct or the gate is theater |
| Every task | **GPT-5.6 Sol** adversarial review | Caught the GSAP licensing issue Kimi missed |

---

## Risks

- **The gate is theater if the janky fixture doesn't actually fail.** C7 requires the negative case. Non-negotiable.
- **Headless ≠ smooth.** Headless screenshots cannot prove smoothness; the harness must use headed hardware-accelerated Chrome with real input.
- **T7 touches 441 files.** Machine-generated, guard-tested, single commit, easily reverted.
- **T3 may delete capability the UI advertises.** Deleting a phantom ID is honest; the decision table records each call.
