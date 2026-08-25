# Sub-50 ms Page-Load Loop Implementation Plan

**Goal:** Measure every static MishMash Studio route under one repeatable warm-navigation harness, bring every route-ready transition below 50 ms, and prioritize `/templates` without regressing cold-load or UI behavior.

**Architecture:** Add a deterministic Playwright benchmark module plus runner that opens one production Studio session, warms shared data once, navigates from Home to each static route, waits for a route-owned ready selector and two animation frames, and reports seven-run median/p95 results. Keep cold DOMContentLoaded and transferred bytes as guardrails. Optimize one bounded rendering cost at a time, rerunning the complete route matrix after each accepted change.

**Tech Stack:** TypeScript, React 18, Next.js 16 static export, Playwright 1.60, Vitest 4, Node 24, pnpm 10.33.2.

**Spec:** Published [The sub-50 ms page-load loop](https://signals.forwardfuture.com/loop-library/loops/sub-50ms-page-load-loop/), adapted to MishMash's client-routed Studio.

## Global Constraints

- Benchmark the same route list, viewport (1440x900), Chromium version, one warm-up, seven measured runs, ready selectors, and two-frame settle on every pass.
- The 50 ms gate applies to warm in-app route-ready transition p95; cold DOMContentLoaded and transferred bytes are recorded guardrails, not relabeled as the target.
- Include `/`, `/projects`, `/automations`, `/plugins`, `/design-systems`, `/design-library`, `/storyboard`, `/templates`, `/typefaces`, `/academy`, `/integrations`, `/marketplace`, and `/interview`.
- A change is retained only when the full matrix improves or stays neutral and focused behavior tests pass.
- Preserve the live root checkout and service; all edits and benchmark runtime state stay in this worktree/namespace.
- Stop as `SUCCESS`, `STAGNATED`, `BLOCKED`, or `APPROVAL_REQUIRED`; never weaken the metric or omit a slow route.

---

### Task 1: Repeatable full-route benchmark

**Files:**
- Create: `e2e/lib/playwright/page-load-benchmark.ts`
- Create: `e2e/lib/playwright/run-page-load-benchmark.ts`
- Create: `e2e/tests/page-load-benchmark.test.ts`

**Interfaces:**
- Produces: `PAGE_LOAD_TARGETS`, `summarizeSamples(samples)`, `evaluatePageLoad(results, thresholdMs)`, and a `tsx` runner accepting `OD_PERF_BASE_URL` and `OD_PERF_OUTPUT`.

- [x] **Step 1: Write failing tests for the route inventory and statistics.** Assert the literal 13-route inventory, median/p95 selection, rejection of empty/non-finite samples, and failure when any route p95 is `>= 50`.
- [x] **Step 2: Run the focused Vitest file and verify RED because the module does not exist.**
- [x] **Step 3: Implement the minimal pure benchmark helpers and rerun the focused test to GREEN.**
- [x] **Step 4: Add the Playwright runner.** It warms every route once, measures seven Home-to-target transitions, uses route-owned selectors, captures cold navigation timing, writes JSON, prints a compact table, and exits non-zero when any p95 misses 50 ms.
- [x] **Step 5: Build the current tree, run the full benchmark, and save the baseline JSON outside tracked source.**

### Task 2: Templates first-paint rendering budget

**Files:**
- Modify: `apps/web/src/styles/home/templates.css`

**Interfaces:**
- Produces: browser-native off-screen rendering containment while preserving the complete catalog DOM, counts, filters, search results, and keyboard navigation.

- [x] **Step 1: Establish RED with the full-route benchmark.** `/templates` measured 85.1 ms p95 against the 50 ms gate.
- [x] **Step 2: Apply the smallest rendering optimization.** Add `content-visibility`, containment, and an intrinsic card size, matching MishMash's existing large-gallery pattern.
- [x] **Step 3: Rerun all TemplatesSection tests.** All 12 passed without changing the component's data or interaction contract.
- [x] **Step 4: Rebuild and rerun all 13 routes.** `/templates` fell below the gate while every other route remained in the matrix.

### Task 3: Continue the bounded optimization loop

**Files:**
- Modify only files identified by current benchmark/profiling evidence.
- Update: `docs/plans/2026-08-25-sub-50ms-page-load-loop.md` with measured checkpoints and terminal state.

**Interfaces:**
- Consumes: the unchanged Task 1 benchmark JSON schema and route matrix.
- Produces: a final result where all route p95 values are below 50 ms, or an evidenced non-success terminal state.

- [x] **Step 1: Choose the single slowest failing route from the latest full matrix.** The isolated production pass identified `/design-library` at 64.3 ms p95.
- [x] **Step 2: Write and observe a failing retention contract test.** The source contract now requires a memoized lazy boundary, a stable callback, and a permanently active mounted catalog after first visit.
- [x] **Step 3: Apply reversible optimizations.** Stabilize the retained Design Library subtree and add the same browser-native off-screen card containment used by other large galleries.
- [x] **Step 4: Rebuild and rerun the unchanged full-route benchmark after each significant change.** The memoization-only pass did not clear the gate; the containment pass did.
- [x] **Step 5: Stop at all-routes-under-50 success.** Two subsequent full-matrix runs also passed.
- [x] **Step 6: Run workspace/web/e2e typechecks, 5,456 web tests, the repository guard, production build, benchmark contract tests, and direct visual checks of Templates and Design Library.**

## Checkpoints

- Finalized-harness baseline, unchanged live main with 561 templates: `/templates` failed at 103.8 ms p95; the other 12 routes passed, including `/typefaces` at 49.2 ms.
- Pass 1, Templates containment: `/templates` cleared the gate in the isolated production lane; the matrix then exposed `/design-library` at 68.2 ms p95.
- Pass 2, retained-tree memoization: `/design-library` still failed at 68.4 ms p95, so the loop continued.
- Pass 3, Design Library card containment: all 13 routes passed. Early isolated runs used a 362-template fixture and were treated as diagnostics only once the catalog-size mismatch was found.
- Final catalog-matched run: the isolated runtime was reseeded with the same 561-template snapshot as the unchanged baseline. All 13 routes passed; `/templates` measured 39.5 ms p95 and `/design-library` 28.0 ms p95.
- Final catalog-matched confirmation: all 13 routes passed again. `/templates` was the slowest route at 39.7 ms p95; `/design-library` measured 26.3 ms p95. Cold navigation guardrails ranged from 10.5-17.6 ms DOMContentLoaded with a maximum 10,915 transferred bytes.
- Terminal state: **SUCCESS** under the defined warm in-app route-ready p95 metric.

## Final Verification

- `pnpm typecheck`: passed across the workspace.
- `pnpm guard`: passed, including all 202 guard subtests.
- `pnpm --filter @open-design/web test`: 520 files passed; 5,456 tests passed and 1 skipped.
- `pnpm --filter @open-design/e2e typecheck`: passed.
- Benchmark contract: 4 tests passed.
- `pnpm --filter @open-design/web build`: production static export passed and served zero source maps.
- Direct visual inspection: settled Templates and Design Library catalog views render correctly at 1440x900.
