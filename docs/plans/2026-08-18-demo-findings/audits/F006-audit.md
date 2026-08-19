F006

## 1. Factual accuracy

- **Module count is wrong/ambiguous.** Claimed: “19 modules.” Actual: 17 top-level `.ts` files, 18 non-fixture production `.ts` files recursively, or 21 including fixture code; no documented count yields 19. The module map enumerates the production surface at `apps/daemon/src/critique/AGENTS.md:10-29`. `orchestrator.ts` is 37,785 bytes—36.9 KiB, not 36.9 KB.

- **The test result is unverifiable and overstates coverage.** No test receipt supports “241 passed, 4 todo.” The command selects 20 root `critique-*.test.ts` files but excludes the current parser, scoreboard, logging, and metrics suites at `apps/daemon/tests/critique/parsers/v1.test.ts:1-19`, `apps/daemon/tests/critique/scoreboard.test.ts:1-17`, `apps/daemon/tests/logging/critique.test.ts:1-13`, and `apps/daemon/tests/metrics/critique.test.ts:1-24`; the configured daemon suite includes all `tests/**/*.test.*` files (`apps/daemon/vitest.config.ts:3-10`). A read-only rerun could not start because Vitest attempted to write `.vite-temp`, so the numeric result was not independently reproduced.

- **The tests do not establish real spawn wiring.** `critique-spawn-wiring.test.ts` explicitly says it does not spawn a child and instead tests seams/simulates the branch (`apps/daemon/tests/critique-spawn-wiring.test.ts:1-8`, `:175-204`). The UI e2e injects synthetic SSE frames and stubs the interrupt endpoint rather than running the orchestrator (`e2e/ui/critique-theater.test.ts:33-36`, `:154-168`). Therefore “working correctly” is not proven.

- **The database counts are stale.** Current `.od/app.sqlite` contains `critique_runs=0`, `messages=153`, `projects=29`, not `messages=144`, `projects=28`.

- **“It has never run—not once” is not established by zero rows.** The active data root can differ through `OD_DATA_DIR` (`apps/daemon/src/daemon-paths.ts:125-139`), critique rows cascade-delete with projects (`apps/daemon/src/critique/persistence.ts:176-191`), and code can explicitly delete a run (`apps/daemon/src/critique/persistence.ts:295-311`). Zero rows proves only that this database currently retains no rows.

- **The PID/environment claim is unverifiable.** Process inspection of PID 83163 is unavailable in the audit sandbox; the finding preserves no command receipt.

- **“Sitting at M0” is stale.** M0 remains the default, but the M1 Settings toggle already ships (`apps/web/src/components/SettingsDialog.tsx:8390-8408`), and a project override wins even when phase is M0 (`apps/daemon/src/critique/rollout.ts:91-103`). It can already be activated per project without changing the shipped default.

- **The panel scopes are not non-overlapping.** CRITIC scores contrast and A11Y also scores contrast (`apps/daemon/src/prompts/panel.ts:110-122`).

- **Forced disagreement is prompt text, not a guard.** `weak_debate` exists in the contract (`packages/contracts/src/critique.ts:93-100`), but no production parser emits it; its conformance case is still `todo` (`apps/daemon/tests/critique-conformance.test.ts:451-464`).

- **Mandatory per-panelist findings are not enforced.** The parser merely emits whatever `<MUST_FIX>` tags exist (`apps/daemon/src/critique/parsers/v1.ts:519-528`), and the orchestrator totals them without checking each scoring role (`apps/daemon/src/critique/orchestrator.ts:334-365`). The wiring test ships a run where every scoring panelist emits zero MUST_FIX entries (`apps/daemon/tests/critique-spawn-wiring.test.ts:108-145`). The claim that the jury “cannot pass something by saying nothing” is false.

- **Maker/judge separation is only role-play.** One model in one CLI session is instructed to speak as all five panelists (`apps/daemon/src/prompts/panel.ts:89-108`); only the designer’s numeric weight is separated.

- **The prompt-injection statement is overstated.** Code neutralizes closing-tag and CDATA syntax (`apps/daemon/src/prompts/panel.ts:65-78`) and tells the model to treat the body as data (`:129-134`); arbitrary instruction-like prose inside `DESIGN.md` is not mechanically filtered.

- **`stop-slop` is not enforced at build time.** The actual anti-slop mechanism is `lintArtifact`, wired only into the live Claude stream-JSON path; other runtimes receive no in-turn feedback and persistence is never blocked (`apps/daemon/src/lint-artifact.ts:15-36`).

- **Alex Roth Ceramics is not currently a runnable subject.** Its database project row is named `Hey Id Like You Build Out` with `skill_id=NULL` and `design_system_id=NULL`; its directory has one HTML artifact plus notes/metadata. Critique requires both resolved brand and skill context (`apps/daemon/src/server.ts:4409-4415`, `:4433-4438`).

- **R6 describes the wrong ratchet input.** Real `critique_runs` do not feed the ratchet. Conformance history is written by a synthetic-fixture runner (`apps/daemon/src/critique/__fixtures__/run-prerelease.ts:1-17`, `:38-80`), and the referenced `.github/workflows/critique-conformance.yml` does not exist. The ratchet only returns a recommendation; it does not change rollout state (`apps/daemon/src/critique/ratchet.ts:1-17`).

- **The claimed “finished” configuration omits a specified control.** `maxConcurrentRuns` exists with a promised `OD_CRITIQUE_MAX_CONCURRENT_RUNS` override (`packages/contracts/src/critique.ts:47`, `:71-72`), but the loader never reads that variable (`apps/daemon/src/critique/config.ts:15-41`) and the registry enforces no cap (`apps/daemon/src/critique/run-registry.ts:75-107`).

## 2. Repo-rule compliance

- Activating Design Jury as a user-facing capability without CLI parity is unmergeable. The UI and daemon paths exist, but `SUBCOMMAND_MAP` contains no `critique` command (`apps/daemon/src/cli.ts:900-957`), contrary to `AGENTS.md:167-175`.

- The project toggle is not represented in the shared contract. `ProjectMetadata` ends without `critiqueTheaterEnabled` (`packages/contracts/src/api/projects.ts:99-243`), while the web writes that untyped field (`apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts:219-225`). The PR must add the pure-TS contract before relying on it.

- If `/api/critique/conformance` is part of the promotion/operator workflow, it also lacks a shared request/response DTO and CLI/UI parity; the route currently returns an ad hoc object (`apps/daemon/src/routes/daemon.ts:145-172`).

## 3. Executability unattended

- **R1:** No durable configuration target, lifecycle command, namespace, rollback, or restart is specified. Config loads once at boot (`apps/daemon/src/server.ts:1144-1147`), and enabling still skips runs without brand, skill, or a plain-stream adapter (`apps/daemon/src/server.ts:4433-4438`).

- **R1:** `OD_CRITIQUE_ENABLED=1` enables eligible backend runs globally, while the Theater UI remains governed by unrelated browser localStorage (`apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts:14-23`). This can spend tokens invisibly.

- **R2:** It records only four settings. Effective behavior also depends on cast, weights, total timeout, parser cap, fallback policy, protocol version, and concurrency (`packages/contracts/src/critique.ts:58-72`).

- **R3:** No token-measurement mechanism or evidence destination is specified. Critique persistence has no token/cost fields (`apps/daemon/src/critique/persistence.ts:155-188`); metrics expose round duration but not tokens (`apps/daemon/src/metrics/index.ts:36-99`).

- **R4:** No five-artifact corpus, prompts, models, adapter, execution order, or stop rules are defined. Claude and Codex are structured adapters (`apps/daemon/src/runtimes/defs/claude.ts:90-96`, `apps/daemon/src/runtimes/defs/codex.ts:197-206`) and are therefore excluded by the plain-stream gate.

- **R5:** Existing machinery retains only the final SHIP artifact, not automatic pre/post pairs (`apps/daemon/src/critique/orchestrator.ts:267-274`, `:482-505`). `lintArtifact` is a narrow anti-slop heuristic, not a brand/WCAG/functional comparator (`apps/daemon/src/lint-artifact.ts:1-13`).

- **R6 / criterion 5:** Five runs tonight cannot produce promotion evidence. Promotion requires a complete 14-day window by default (`apps/daemon/src/critique/ratchet.ts:72-81`, `:200-247`).

- **Verification:** The SQLite command hard-codes the legacy repository `.od` fallback instead of the daemon’s resolved `RUNTIME_DATA_DIR` (`apps/daemon/src/server.ts:891-919`) and violates the data-path documentation rule (`AGENTS.md:60-72`). Its query proves none of token cost, retained before/after artifacts, lint improvement, or ratchet input.

- **Verification:** It omits required `pnpm guard`, `pnpm typecheck`, web tests, and real cross-surface/e2e validation (`AGENTS.md:291-299`).

- The open “every build or on request” decision is unresolved; a sleeping author cannot answer it.

## 4. Missing work

- Add the typed project-setting contract, dedicated HTTP shape, `od critique` command with `--json`, and matching UI behavior in one PR.
- Define unset/existing-project migration semantics and reconcile global localStorage state with per-project daemon state.
- Implement or explicitly cap concurrency before unattended real-model runs.
- Add durable evidence records containing project/artifact hashes, exact prompt, adapter/model, effective config, before/after paths, lint results, tokens, duration, and terminal status.
- Wire real-run evidence into a defined promotion mechanism; the current synthetic fixture ratchet is not that mechanism.
- Add a real fake-agent HTTP/UI/CLI integration test. Existing e2e uses mocked SSE, and its visual cases remain `fixme` (`e2e/ui/critique-theater.test.ts:260-279`).
- Any new visible text must be added to both the typed dictionary and English locale; those are the repository’s two required i18n surfaces (`AGENTS.md:275-280`).

## 5. Risk of silent damage

- Backend critique can run while the UI is hidden, removing the user’s visible interrupt path.
- The missing concurrency cap can multiply token spend and process load.
- Artifact-write failure does not prevent a run from finalizing and emitting SHIP (`apps/daemon/src/critique/orchestrator.ts:482-539`); the listed SQL can therefore report success with no retained post artifact.
- The project toggle’s GET–merge–PATCH is explicitly last-write-wins and can revert unrelated metadata during a race (`apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts:111-121`).
- A lower lint count can be achieved by deleting content or functionality; no listed test checks rendering, interaction, brand fidelity, WCAG, or regression against the original.
- Deleting a sampled project can cascade-delete its critique evidence (`apps/daemon/src/critique/persistence.ts:189-190`).

VERDICT: NOT-READY

Before execution, decide the exact activation scope and supported plain adapter/model, define an eligible five-artifact corpus and objective evidence protocol, close contract/HTTP/UI/CLI parity, implement cost/concurrency measurement, and determine how real runs—not synthetic fixture days—can legitimately drive rollout promotion.

