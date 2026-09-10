# Gauntlet fast loop (preferred method from wave 8)

Owner decision 2026-09-09. Waves of features are built by coding agents in parallel worktrees, audited once at the end, and landed as one PR. This file states the method so every session and tool follows the same one; the runnable scripts live in the driver's goal-state folder, outside the repo.

## Steps per wave

1. **Pre-wave.** Flaky tests and gate-script fixes land first as a small PR. Model and reviewer lanes are frozen before launch. No track depends on an unmerged branch.
2. **Launch gate.** A script fails the launch when two tracks own the same file without distinct regions in the wave spec's same-file table. One five-minute reviewer read of the spec returns the shared-file owner map. No other audit before the build.
3. **Build.** Every track at once, each in its own worktree. Red test first, then the fix as an invariant, on the track's own test files only. Typecheck, guard, i18n check, and the in-bounds P0 Playwright spec only when the track changes a user flow. Each track self-gates the moment it is green. No review, no PR, no CI during the build. The branch is pushed once at the end.
4. **Integrate.** All branches merge onto current main in one integration worktree. Light gates run in parallel on the test box; one Playwright process runs last.
5. **The audit.** The reviewer (Grok 4.6, document-only) receives N+1 packets at once: one per track diff and one join packet limited to the shared files, the merge result, and the changed tests. MEDIUM or higher findings get one fix round on the track branches, a re-merge, and a delta re-review of the affected packets. Cap: two rounds. LOW findings ship, disclosed.
6. **One PR per wave.** Opened only after the audit passes. The body carries one section per track. One CI run.
7. **Land.** Merge commit, never squash: each track's commits stay revertable on their own.
8. **One restart.** The team daemon restarts once after the merge, only when daemon-served paths changed, never while a run is active. Smoke under two minutes: health with a new boot id, one GET of the wave's primary surface, one write-path POST when the wave writes, tailnet health. No benchmark-driven restarts on wave days.
9. **Closeout** from a template. No closeout audit unless the owner asks.

## Model lanes inside a track

- The Claude driver model owns the track: contract design, daemon routes, job and state machines, error paths, integration conflicts, the fix round.
- Gemini 3.8 Flash does bounded bursts only: red-test stubs, i18n key pairs, docs tables, barrel exports and CLI registry lines after the contract exists, Playwright spec stubs. Typecheck after every burst; two failures and the driver takes the file. At most two Flash processes at once.
- Grok 4.6 is the only scheduled reviewer. Codex is a rescue lane for a second diagnosis, not a step.

## Rules that stay

Never run a full test suite outside CI (D-27). Region ownership for shared files. Contracts before consumers. Tests under `tests/`, never `src/`. UI and CLI halves ship together. No history rewrites, no stash, no attribution trailers. Credentials from the vault only. The live data root is read-only evidence. Every gate command is recorded with its exit code.

## Why

Wave 7 measured 5 h 15 m of building and about 3 h of everything after it: per-track review rounds, four PRs, seven CI runs, serialized landing with a re-fold, and four daemon restarts in one day. The loop above keeps the build and removes the rest. Expected post-build time: about 45 minutes.
