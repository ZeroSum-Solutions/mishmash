# Daemon test-suite baseline (2026-07-26)

Attribution record for every daemon test failing on `main` (`8be533898`) when the
full suite was measured ahead of restoring it as a CI gate. Fork point:
`c401b99fa` (merge-base with `upstream-pinned/main`). "Pre-existing" below means
the identical failure was reproduced by running the test at that commit in a
pristine worktree — not inferred from git history alone.

Two full-suite runs were captured; the failing set shifted slightly between them
(timing-sensitive tests trade places under load), so this table covers the union.
Suite shape at baseline: 483 files / 6,005 tests; 6 files / 14 tests failing in
the instrumented run, plus 2 additional flaky tests seen only in earlier runs.

**Every failure was fixed. No test is quarantined; there are no `.skip` markers
from this pass.**

| Test | Attribution | Root cause | Fix |
|---|---|---|---|
| `plugins-marketplaces.test.ts` › keeps the checked-in official registry populated from bundled plugins | **Fork-introduced** (commits `b42d1e04f`, `4acc88bad`, `af50e5e6a`) | De-brand/English-only sweep deleted 4 plugin entries (414→410) without updating the manifest's own `bundledPreinstallCount` | Manifest field corrected to 410; test untouched |
| `amr-session-resume.test.ts` — 8 tests | Pre-existing, environment-dependent (identical 8-fail at fork point) | Suite implicitly requires host AMR credentials (`~/.amr/config.json` or `VELA_RUNTIME_KEY`/`VELA_LINK_URL`); server spawn gate returns `AMR_AUTH_REQUIRED` before vela is ever spawned | Env vars stubbed in `beforeEach`, mirroring `chat-route`/`run-retry-runtime` suites |
| `chat-route.test.ts` › passes keyless BYOK provider config… | Pre-existing, deterministic (fails at fork point) | Test expects `@ai-sdk/openai` for a non-`api.openai.com` host; `buildProviderEntry` intentionally routes such hosts to `@ai-sdk/openai-compatible` | Test expectation corrected |
| `chat-route.test.ts` › does not leave a pinned assistant message queued when legacy chat fails before spawning | Pre-existing, deterministic (fails at fork point) — **product bug** | Legacy `POST /api/chat` never called `pinAssistantMessageOnRunCreate`, so a pre-spawn failure had no message row to flip to `failed` | Source fix in `routes/runs.ts`, mirroring the `POST /api/runs` handler |
| `chat-route.test.ts` › fails stalled json-stream runs… / › marks stalled runs failed even when the child ignores SIGTERM | Pre-existing flake (bodies byte-identical to fork point; documented in `docs/plans/plugins-implementation.md` as inherited from upstream PR #832) | 500 ms inactivity window loses to scheduler contention | Window widened to 3000 ms, matching the neighboring keep-alive test |
| `run-retry-runtime.test.ts` › retry-event assertions (two tests observed flaking across runs) | Pre-existing flake (fork-point rate ≥ main's: 5/6 vs 3/6 isolated runs) | Two distinct mechanisms, each proven with captured evidence: (1) tests read `events.jsonl`, but disk persistence is explicitly best-effort — `ensureLogStream` discards buffered writes on stream error, so early events can be permanently absent from the file while the in-memory ring buffer is complete; (2) the daemon's login probe (`claudeAgentDef.authProbe: ['auth','status']`) races the chat spawn against the same fixture binary, and the fixtures' attempt counters counted the probe as an attempt — when the probe won the race it consumed the failure branch and the tracked run's first attempt "succeeded" with no retry (invocation-log capture: probe argv `auth status` arriving between attempts) | (1) `readRunEvents` reads the SSE replay of the ring buffer (`GET /api/runs/:id/events`) — the surface the daemon actually guarantees; (2) all three claude fixtures answer `auth` without touching the counter, like the real CLI. 10/10 consecutive full-file runs clean post-fix |
| `prompts/system-prompt-matrix.test.ts` › keeps the section gating matrix stable | Pre-existing (identical failure at fork point) | Snapshot's `totalChars` values drifted upstream by −9 chars per affected scenario; section gating matrix itself unchanged (verified: zero non-`totalChars` diff lines) | Snapshot regenerated as a standalone attributed change |
| `runtimes/run-failure-telemetry-smoke.test.ts` › drives representative failed runs… | Pre-existing, environment-sensitive (code path byte-identical to fork point) | `context_window` fixture (~56 KB) only trips the POSIX argv budget floor (`max(def.maxPromptArgBytes, 120k)`) when composed-prompt overhead pads past it | Fixture enlarged to ~140 KB so it clears the floor deterministically |

Adjacent issue (out of scope here, noted for follow-up): the `finish()`/events-log
flush ordering race in `apps/daemon/src/runtimes/runs.ts` is real daemon behavior —
any consumer reading `events.jsonl` immediately after observing a terminal run
status can see an incomplete log. The baseline pass hardens the test; the
durability ordering itself deserves its own issue.

Evidence artifacts (commands, SHAs, exit codes, raw output) are retained in the
operator's goal-state proof directory for run `mishmash-docket-1-7`.
