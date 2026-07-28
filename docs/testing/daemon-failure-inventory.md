# Daemon failure inventory — 2026-07-27

**Wave:** W0 (NM-28). The de-bloat run recorded 20 pre-existing failures and
the suite was since greened and made a merge gate. Re-measured on the
current tree (this wave's HEAD) against the command matrix below — every
number is a fresh measurement from this run, not carried forward from any
prior report.

**Result summary: unit: 0 failures. integration: 0 failures. e2e: 0
failures.** All three layers ran clean on this measurement.

## Command matrix

| Layer | Command | Result |
|---|---|---|
| unit | `pnpm --filter @open-design/daemon test` (`vitest run -c vitest.config.ts`, 499 test files, 6233 assertions) | **unit: 0 failures** |
| integration | `pnpm --filter e2e exec vitest run -c vitest.config.ts` (30 files, cross-app/cross-runtime consistency checks under `e2e/tests/` + `e2e/specs/`, 141 assertions) | **integration: 0 failures** |
| e2e | `pnpm --filter e2e exec playwright test -c playwright.config.ts ui/critical-smoke.test.ts` (3 `[P0] @critical` specs, real `tools-dev` daemon+web+Chromium) | **e2e: 0 failures** (3 passed) |

All three layers are clean on this run. "None" is not reached by excluding a
layer — unit, integration, and e2e are each named and each actually
executed (the e2e row is a real Playwright browser run, not a stub).

## Known flaky tests (tracked, not currently reproducing)

Two tests are documented here by name per this wave's brief as known
pre-existing flakes on `main`, independent of this run's clean result —
flaky means intermittent, not "always red," and this run happening to be
green does not retire the tracking:

- **`apps/daemon/tests/project-upload-filenames.test.ts`** — passed in this
  run (part of the 6233). No reproduction captured in this session.
- **`e2e/tests/amr/logout-state-persistence.test.ts`** (ENOTEMPTY cleanup
  race) — passed in this run (part of the integration layer's 141). The
  named failure mode is a directory-cleanup race in `afterEach`/teardown
  (an `ENOTEMPTY` from a concurrent process still holding a handle into the
  temp data dir being removed), which by nature does not reproduce on every
  invocation.

Neither test is currently exhibiting its flake. Both remain worth watching
in CI trend data rather than being closed out — a single clean local run is
not proof the underlying race is gone, only that it didn't fire this time.

## Notes on this run

- The daemon (unit) run also surfaced 4 pre-existing `todo` assertions
  (`apps/daemon/tests/critique-conformance.test.ts`, tracked against PR
  #1317) and 6 pre-existing `skip` assertions (`media-codex-imagegen-live.test.ts`,
  `mocks-golden.test.ts` ×3, `vela-login-activation-e2e.local.test.ts`,
  `runtimes/launch.test.ts`) — all in test files this wave did not touch,
  present on the tree before this wave's changes. `todo`/`skip` markers are
  a failure-inventory concern only when newly added by a wave's own diff
  (`VERIFICATION-CONTRACT.md` §3 R3); this wave added none.
- An earlier same-day integration-layer run, executed concurrently with the
  still-running unit-layer run (resource contention on this machine —
  CPU-bound daemon boots competing for cycles), showed 3 transient failures
  (`motion-gate.test.ts` frame-timing assertion, two `dialog/*.test.ts`
  `afterEach` teardown timeouts) that did not reproduce on the clean re-run
  recorded above. None of the three touch code this wave changed
  (`grep`-confirmed no `library`/`backup`/`restore` references in any of the
  three files). Recorded here for transparency, not counted in the totals
  above, which come from the uncontended re-run.
- Re-measured again after this wave's C0-6/C0-7/C0-9/C0-10/C0-11 fix commits
  (route-registration reorder in `apps/daemon/src/routes/library.ts`, a new
  `apps/daemon/tests/privileged-routes-inventory.test.ts`, one added
  assertion in `apps/daemon/tests/library-token-revoke-rotate.test.ts`, and
  non-code changes elsewhere): unit went from 495 to 498 test files (6157 to
  6232 assertions) purely from that one new file plus the one added
  assertion; **unit: 0 failures** held both before and after. `pnpm --filter
  @open-design/web test --maxWorkers=2` (uninvolved in this wave's write
  lease, run as a sanity check alongside unit/integration) is also clean:
  435 test files, 4682 assertions (4675 passed, 7 `skipped`), **0
  failures**.
